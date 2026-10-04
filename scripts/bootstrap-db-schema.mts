/**
 * Eager database schema bootstrap — dijalankan oleh install.sh setelah
 * `pnpm install` agar boot pertama bersih (tanpa error 42P01 di log).
 *
 * Memakai jalur bootstrap produksi yang sama dengan runtime lazy:
 * - getServerPersistenceProvider: runtime, document, stage_meta (+owner
 *   merges, legacy import bindings), owner materials, asset, classroom jobs,
 *   legacy classroom imports, workspace model config (+ deklarasi asset
 *   reference tracking). Ini runtime lazy tiap proses; di sini dipanggil
 *   sekali di depan agar tabel inti ada sebelum server pertama jalan.
 * - ensureAgentSessionSchema + ensureAgentSessionMaterialSchema: urutan yang
 *   sama seperti createMaterialStore di
 *   lib/server/agent-runtime/session-materials.ts (material mereferensikan
 *   agent_sessions via FK, jadi session dulu — kalau tidak: 42P01
 *   relation "agent_sessions" does not exist di database fresh).
 * - ensureUserSkillSchema: sama seperti createUserSkillStores di
 *   lib/server/agent-runtime/user-skill-store.ts.
 *
 * CATATAN impor: script ini jalan di luar Next (tsx, package root
 * type=commonjs) sehingga modul `@/lib/*.ts` tiba sebagai CJS dan
 * named-export statisnya tidak terdeteksi ESM loader — makanya diambil
 * lewat `require` (hook tsx) dengan tipe penuh `typeof import` (aman tsc).
 * Daftar bootstrap di atas dijaga sejajar dengan pemanggil produksi
 * tersebut; runtime tetap lazy-bootstrap sendiri.
 *
 * Idempoten (semua bootstrap IF NOT EXISTS): aman dijalankan ulang. Runtime
 * tetap lazy-bootstrap sendiri, jadi kegagalan script ini tidak fatal.
 *
 * Pakai: DATABASE_URL=... pnpm exec tsx scripts/bootstrap-db-schema.mts
 */
import { ensureAgentSessionSchema } from '@openmaic/storage/agent-session/pg';
import { ensureAgentSessionMaterialSchema } from '@openmaic/storage/material/pg';
import { ensureUserSkillSchema } from '@openmaic/storage/skill/pg';
import { createRequire } from 'node:module';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';

// Modul `@/lib/*.ts` di bawah package root type=commonjs dimuat tsx sebagai
// CJS, sehingga `import` bernama statis gagal di ESM loader (named-export
// detection). Lewat `require` hasil hook tsx + tipe `typeof import` kiri
// tetap penuh (aman untuk tsc) dan kanan jalan saat runtime.
const scriptRequire = createRequire(import.meta.url);
const { getServerPersistenceProvider } = scriptRequire(
  '@/lib/persistence/server-provider',
) as typeof import('@/lib/persistence/server-provider');
const { withSchemaBootstrapLock } = scriptRequire(
  '@/lib/persistence/schema-bootstrap-lock',
) as typeof import('@/lib/persistence/schema-bootstrap-lock');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[bootstrap-db-schema] DATABASE_URL kosong — tidak ada yang dikerjakan.');
    process.exit(2);
  }
  const provider = await getServerPersistenceProvider(connectionString);
  const queryable = provider.pool as unknown as ConnectableQueryable;
  await withSchemaBootstrapLock(queryable, ensureAgentSessionSchema);
  await withSchemaBootstrapLock(queryable, ensureAgentSessionMaterialSchema);
  await withSchemaBootstrapLock(queryable, ensureUserSkillSchema);
  const tables = await provider.pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename IN ('agent_sessions', 'agent_session_materials', 'agent_user_skill')
     ORDER BY 1`,
  );
  await provider.pool.end().catch(() => undefined);
  console.log(`[bootstrap-db-schema] ok (${tables.rows.map((r) => r.tablename).join(', ')})`);
}

main().catch((error) => {
  console.error(
    '[bootstrap-db-schema] gagal:',
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(1);
});
