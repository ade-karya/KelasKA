import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OwnerAuthMethod } from '@/lib/server/identity/types';

// PGlite creation plus the real routes' dynamic imports are slow on a cold
// module graph (the shared suites pay the same cost); the default 10 s hook
// timeout flakes on the first run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * The admin course library on the real `GET /api/stages` route, the real
 * owner-bound store and an in-memory PostgreSQL: an account with the `admin`
 * role lists every live course, every other account keeps its owner-only
 * listing, and the widened listing is a read (writes stay owner-scoped).
 */

class PGlitePool {
  constructor(readonly db: PGlite) {}

  query(text: string, params?: unknown[]) {
    return this.db.query(text, params);
  }

  async connect() {
    return {
      query: (text: string, params?: unknown[]) => this.db.query(text, params),
      release() {},
    };
  }

  async end() {
    await this.db.close();
  }
}

const USER_HEADER = 'x-test-user';
const ADMIN = 'user:admin';
const ALICE = 'user:alice';
const BOB = 'user:bob';
const NOW = 1_800_000_000_000;

/** A host method that signs in a test account on one header. */
const accountMethod: OwnerAuthMethod = {
  name: 'test-account',
  authenticate: async (req) => {
    const user = req.headers.get(USER_HEADER);
    if (user === 'admin') {
      return {
        status: 'authenticated',
        principal: {
          ownerId: ADMIN,
          kind: 'user',
          roles: new Set(['admin', 'course:publish']),
          assurance: 'verified',
        },
      };
    }
    if (user === 'alice' || user === 'bob') {
      return {
        status: 'authenticated',
        principal: {
          ownerId: `user:${user}`,
          kind: 'user',
          roles: new Set(['course:publish']),
          assurance: 'verified',
        },
      };
    }
    return { status: 'not-applicable' };
  },
};

const as = (user: 'admin' | 'alice' | 'bob') => ({ [USER_HEADER]: user });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function courseDocument(stageId: string) {
  return {
    stage: { id: stageId, name: `Course ${stageId}`, createdAt: NOW, updatedAt: NOW },
    scenes: [],
    outline: {
      outlines: [],
      requirement: stageId,
      generationComplete: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

async function listAs(user: 'admin' | 'alice' | 'bob') {
  const { GET } = await import('@/app/api/stages/route');
  const response = await GET(new NextRequest('http://localhost/api/stages', { headers: as(user) }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { stages: { id: string }[] }).stages.map((stage) => stage.id);
}

describe('admin course library', () => {
  let pool: PGlitePool;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL', `postgres://admin-library-${randomUUID()}`);
    vi.stubEnv('ASSET_S3_BUCKET', '');
    vi.stubEnv('PERSISTENCE_SHARED_OWNER_ID', '');
    vi.stubEnv('OPENMAIC_AGENT_RUNTIME_ENABLED', 'true');
    const { resetOwnerAuthenticationForTests } = await import('@/lib/server/identity/registry');
    resetOwnerAuthenticationForTests();
    const { configureOwnerAuthentication } = await import('@/lib/server/identity');
    configureOwnerAuthentication({ methods: [accountMethod] });
    const { resetPersistenceHooksForTests } =
      await import('@/lib/server/persistence-hooks/registry');
    resetPersistenceHooksForTests();

    const db = new PGlite();
    await db.waitReady;
    pool = new PGlitePool(db);
    const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    await getServerPersistenceProvider(process.env.DATABASE_URL!, () => pool as never);

    const { getOwnerScopedDocumentStore } =
      await import('@/lib/server/agent-runtime/owner-scoped-documents');
    const admin = await getOwnerScopedDocumentStore(ADMIN);
    const alice = await getOwnerScopedDocumentStore(ALICE);
    const bob = await getOwnerScopedDocumentStore(BOB);
    await admin.saveDocument(courseDocument('stage-admin-live') as never);
    await alice.saveDocument(courseDocument('stage-alice-live') as never);
    await alice.saveDocument(courseDocument('stage-alice-deleted') as never);
    await alice.deleteDocument('stage-alice-deleted');
    await bob.saveDocument(courseDocument('stage-bob-live') as never);
    await bob.saveDocument(courseDocument('stage-bob-deleted') as never);
    await bob.deleteDocument('stage-bob-deleted');

    // Seeding went through the stores, which read (and sealed) the empty hook
    // registration; each test registers its own, as a fresh process would.
    resetPersistenceHooksForTests();
  });

  afterEach(async () => {
    const { resetOwnerAuthenticationForTests } = await import('@/lib/server/identity/registry');
    resetOwnerAuthenticationForTests();
    const { resetPersistenceHooksForTests } =
      await import('@/lib/server/persistence-hooks/registry');
    resetPersistenceHooksForTests();
    await pool.end();
    vi.unstubAllEnvs();
  });

  it('lists every live course for an admin, deleted courses excluded', async () => {
    const { registerAdminCourseLibrary } =
      await import('@/lib/server/persistence-hooks/admin-course-library');
    registerAdminCourseLibrary();

    const listed = await listAs('admin');
    expect(new Set(listed)).toEqual(
      new Set(['stage-admin-live', 'stage-alice-live', 'stage-bob-live']),
    );
    expect(listed).not.toContain('stage-alice-deleted');
    expect(listed).not.toContain('stage-bob-deleted');
  });

  it('keeps the owner-only listing for every other account', async () => {
    const { registerAdminCourseLibrary } =
      await import('@/lib/server/persistence-hooks/admin-course-library');
    registerAdminCourseLibrary();

    expect(await listAs('alice')).toEqual(['stage-alice-live']);
    expect(await listAs('bob')).toEqual(['stage-bob-live']);
  });

  it('lets the admin open another owner’s course read-only', async () => {
    const { registerAdminCourseLibrary } =
      await import('@/lib/server/persistence-hooks/admin-course-library');
    registerAdminCourseLibrary();

    const stage = await import('@/app/api/stages/[id]/route');
    const meta = await import('@/app/api/stage-meta/[stageId]/route');

    const read = await stage.GET(
      new NextRequest('http://localhost/api/stages/stage-bob-live', { headers: as('admin') }),
      params('stage-bob-live'),
    );
    expect(read.status).toBe(200);

    const openMeta = await meta.GET(
      new NextRequest('http://localhost/api/stage-meta/stage-bob-live', {
        headers: as('admin'),
      }),
      { params: Promise.resolve({ stageId: 'stage-bob-live' }) },
    );
    expect(openMeta.status).toBe(200);
    await expect(openMeta.json()).resolves.toMatchObject({ isOwner: false });

    const ownMeta = await meta.GET(
      new NextRequest('http://localhost/api/stage-meta/stage-admin-live', {
        headers: as('admin'),
      }),
      { params: Promise.resolve({ stageId: 'stage-admin-live' }) },
    );
    await expect(ownMeta.json()).resolves.toMatchObject({ isOwner: true });

    // The widened listing is a read: a rename through the owner-bound store
    // stays refused (the foreign course is a 404, like a missing one).
    const rename = await stage.PATCH(
      new NextRequest('http://localhost/api/stages/stage-bob-live', {
        method: 'PATCH',
        headers: { ...as('admin'), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed by admin' }),
      }),
      params('stage-bob-live'),
    );
    expect(rename.status).toBe(404);
  });
});
