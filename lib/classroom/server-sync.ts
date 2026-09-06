/**
 * Classroom cloud sync: explicit local <-> Supabase copies.
 *
 * The app's default document store is mode-switched by
 * `NEXT_PUBLIC_PERSISTENCE` (local IndexedDB vs. server Postgres/Supabase via
 * `/api/persistence`). This module bypasses that switch on purpose: it builds
 * BOTH stores explicitly so one classroom can be copied in either direction
 * regardless of the configured default.
 *
 * - Upload (`uploadClassroomToServer`): read the classroom from the browser
 *   (IndexedDB `maic-documents` + `maic-runtime`, with the legacy Dexie
 *   fallback) and overwrite the server copy (Supabase).
 * - Download (`downloadClassroomFromServer`): read the classroom from the
 *   server and overwrite the browser copy.
 *
 * Each copy covers the document aggregate (stage, scenes, outline) plus the
 * chat sessions. The editor cursor (`editor-current-scene:*` in localStorage)
 * is deliberately device-local and is left untouched in both directions.
 * Media asset bytes referenced by scenes are NOT copied — a scene that points
 * at a device-local blob keeps pointing at it.
 *
 * Auth: document routes are partitioned by the anonymous owner cookie the
 * browser already carries (same-origin fetch sends it automatically), while
 * runtime (chat) routes need the Bearer dev token plus the learner key, which
 * this module attaches explicitly so sync works even when the
 * `NEXT_PUBLIC_PERSISTENCE` default is local.
 *
 * Client-only: the local stores touch IndexedDB/localStorage on construction
 * use. Never import this module from server code.
 */
import {
  BrowserDocumentStore,
  BrowserRuntimeStore,
  HttpDocumentStore,
  HttpDocumentStoreError,
  type DocumentStore,
  type RuntimeStore,
} from '@openmaic/storage';
import { HttpRuntimeStore, HttpRuntimeStoreError } from '@openmaic/storage/runtime/http';

import { accessDocument, mutateDocument, type AppStage } from '@/lib/document-store';
import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import { createLogger } from '@/lib/logger';
import { getLearnerKey } from '@/lib/runtime/learner-key';
import { APP_RUNTIME_PAYLOAD_VALIDATORS } from '@/lib/runtime/payload-validators';
import type { AppScene } from '@/lib/types/stage';
import { loadChatSessions, saveChatSessions } from '@/lib/utils/chat-storage';

const log = createLogger('ClassroomServerSync');

/** IndexedDB names mirror the app's default local stores. */
const LOCAL_DOCUMENT_DB_NAME = 'maic-documents';
const LOCAL_RUNTIME_DB_NAME = 'maic-runtime';
const SERVER_BASE_URL = '/api/persistence';

export interface ClassroomSyncResult {
  stageId: string;
  scenes: number;
  chats: number;
}

/**
 * Machine-readable sync failure. `message` is a short English reason the UI
 * interpolates into its localized `classroom.syncFailed` toast.
 */
export class ClassroomSyncError extends Error {
  constructor(
    readonly code:
      | 'local-missing'
      | 'server-missing'
      | 'server-unconfigured'
      | 'server-forbidden'
      | 'unreachable'
      | 'sync-failed',
    message: string,
  ) {
    super(message);
    this.name = 'ClassroomSyncError';
  }
}

function localDocumentStore(): DocumentStore<AppScene, AppStage> {
  return new BrowserDocumentStore<AppScene, AppStage>({
    dbName: LOCAL_DOCUMENT_DB_NAME,
    validateScene: validateAppScene,
    validateStage: validateAppStage,
  });
}

function serverDocumentStore(): DocumentStore<AppScene, AppStage> {
  // Document routes authenticate via the anonymous owner cookie, which
  // same-origin fetch carries automatically — no explicit headers needed.
  return new HttpDocumentStore<AppScene, AppStage>({
    baseUrl: SERVER_BASE_URL,
    validateScene: validateAppScene,
    validateStage: validateAppStage,
  });
}

function localRuntimeStore(): RuntimeStore {
  return new BrowserRuntimeStore({
    dbName: LOCAL_RUNTIME_DB_NAME,
    payloadValidators: APP_RUNTIME_PAYLOAD_VALIDATORS,
  });
}

/**
 * Runtime (chat) headers independent of the `NEXT_PUBLIC_PERSISTENCE` switch:
 * the Bearer dev token plus the device learner key, so the server attributes
 * the synced sessions to the same learner partition this browser normally
 * writes to.
 */
async function serverRuntimeHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = process.env.NEXT_PUBLIC_PERSISTENCE_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    headers['x-learner-key'] = await getLearnerKey();
  } catch (error) {
    log.warn('Classroom sync proceeds without a learner key:', error);
  }
  return headers;
}

function serverRuntimeStore(): RuntimeStore {
  return new HttpRuntimeStore({
    baseUrl: SERVER_BASE_URL,
    headers: () => serverRuntimeHeaders(),
  });
}

function toSyncError(error: unknown, direction: 'upload' | 'download'): ClassroomSyncError {
  if (error instanceof ClassroomSyncError) return error;
  const status =
    error instanceof HttpDocumentStoreError || error instanceof HttpRuntimeStoreError
      ? error.status
      : undefined;
  const code =
    error instanceof HttpDocumentStoreError || error instanceof HttpRuntimeStoreError
      ? error.code
      : undefined;
  if (status === 404 && code === 'PERSISTENCE_NOT_CONFIGURED') {
    return new ClassroomSyncError(
      'server-unconfigured',
      'Supabase is not configured on the server (DATABASE_URL or token missing).',
    );
  }
  if (status === 401 || status === 403 || code === 'FORBIDDEN_DOCUMENTS') {
    return new ClassroomSyncError(
      'server-forbidden',
      direction === 'upload'
        ? 'The server refused to save this classroom.'
        : 'The server refused access to this classroom.',
    );
  }
  if (
    status === 404 ||
    code === 'DOCUMENT_NOT_FOUND' ||
    code === 'SCENE_NOT_FOUND' ||
    code === 'SESSION_NOT_FOUND'
  ) {
    return direction === 'download'
      ? new ClassroomSyncError(
          'server-missing',
          'This classroom has no copy on Supabase yet. Upload it first.',
        )
      : new ClassroomSyncError('server-missing', 'The server copy was not found.');
  }
  if (error instanceof TypeError) {
    return new ClassroomSyncError(
      'unreachable',
      'Cannot reach the server. Check your connection and try again.',
    );
  }
  log.error(`Classroom ${direction} failed:`, error);
  return new ClassroomSyncError(
    'sync-failed',
    error instanceof Error ? error.message : 'Unknown sync error.',
  );
}

async function copyDocument(
  stageId: string,
  from: DocumentStore<AppScene, AppStage>,
  to: DocumentStore<AppScene, AppStage>,
  missing: ClassroomSyncError,
): Promise<number> {
  const source = await accessDocument(stageId, { store: from });
  if (!source.document) throw missing;
  const snapshot = source.document;
  await mutateDocument(
    stageId,
    async (_existing, store) => {
      await store.saveDocument(snapshot);
    },
    { store: to },
    { mode: 'replace' },
  );
  return snapshot.scenes.length;
}

async function copyChats(
  stageId: string,
  from: RuntimeStore,
  to: RuntimeStore,
  learnerKey: string,
): Promise<number> {
  // The destination write intentionally carries no snapshot: it converges the
  // destination partition onto the source set instead of diffing against a
  // snapshot captured from a different store.
  const sessions = await loadChatSessions(stageId, { store: from, learnerKey });
  await saveChatSessions(stageId, sessions, { store: to, learnerKey });
  return sessions.length;
}

/**
 * Copy a classroom from the browser to Supabase, overwriting the server copy
 * (document aggregate + chat sessions).
 */
export async function uploadClassroomToServer(stageId: string): Promise<ClassroomSyncResult> {
  try {
    const learnerKey = await getLearnerKey();
    const scenes = await copyDocument(
      stageId,
      localDocumentStore(),
      serverDocumentStore(),
      new ClassroomSyncError('local-missing', 'This classroom is not in this browser.'),
    );
    const chats = await copyChats(stageId, localRuntimeStore(), serverRuntimeStore(), learnerKey);
    log.info(`Uploaded classroom ${stageId} to server (${scenes} scenes, ${chats} chats)`);
    return { stageId, scenes, chats };
  } catch (error) {
    throw toSyncError(error, 'upload');
  }
}

/**
 * Copy a classroom from Supabase to the browser, overwriting the local copy
 * (document aggregate + chat sessions). Callers confirm destructive overwrites
 * in the UI before invoking this.
 */
export async function downloadClassroomFromServer(stageId: string): Promise<ClassroomSyncResult> {
  try {
    const learnerKey = await getLearnerKey();
    const scenes = await copyDocument(
      stageId,
      serverDocumentStore(),
      localDocumentStore(),
      new ClassroomSyncError(
        'server-missing',
        'This classroom has no copy on Supabase yet. Upload it first.',
      ),
    );
    const chats = await copyChats(stageId, serverRuntimeStore(), localRuntimeStore(), learnerKey);
    log.info(`Downloaded classroom ${stageId} from server (${scenes} scenes, ${chats} chats)`);
    return { stageId, scenes, chats };
  } catch (error) {
    throw toSyncError(error, 'download');
  }
}
