/**
 * File-based storage for Dinas Pendidikan catalog data.
 *
 * Stores catalog entries in a JSON file under /tmp or data directory.
 * In production, this should be replaced with a proper database.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { CatalogEntry } from '@/lib/types/dinas';
import { createLogger } from '@/lib/logger';

const log = createLogger('DinasStore');

const DATA_DIR = join(process.cwd(), 'data', 'dinas');
const CATALOG_FILE = join(DATA_DIR, 'catalog.json');

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
    log.info(`Created dinas data directory: ${DATA_DIR}`);
  }
}

// ---------------------------------------------------------------------------
// Catalog CRUD
// ---------------------------------------------------------------------------

export async function readCatalog(): Promise<CatalogEntry[]> {
  try {
    await ensureDataDir();
    if (!existsSync(CATALOG_FILE)) {
      return [];
    }
    const raw = await readFile(CATALOG_FILE, 'utf-8');
    return JSON.parse(raw) as CatalogEntry[];
  } catch (error) {
    log.error('Failed to read catalog:', error);
    return [];
  }
}

export async function writeCatalog(entries: CatalogEntry[]): Promise<void> {
  await ensureDataDir();
  await writeFile(CATALOG_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

export async function addCatalogEntry(entry: CatalogEntry): Promise<CatalogEntry> {
  const catalog = await readCatalog();
  // Prevent duplicate classroomId
  const existing = catalog.findIndex((e) => e.classroomId === entry.classroomId);
  if (existing >= 0) {
    catalog[existing] = entry;
  } else {
    catalog.push(entry);
  }
  await writeCatalog(catalog);
  log.info(`Catalog entry saved: ${entry.id} (classroom=${entry.classroomId})`);
  return entry;
}

export async function removeCatalogEntry(id: string): Promise<boolean> {
  const catalog = await readCatalog();
  const idx = catalog.findIndex((e) => e.id === id);
  if (idx < 0) return false;
  catalog.splice(idx, 1);
  await writeCatalog(catalog);
  return true;
}
