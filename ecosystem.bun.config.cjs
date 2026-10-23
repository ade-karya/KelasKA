/* eslint-disable @typescript-eslint/no-require-imports -- PM2 loads ecosystem files as CommonJS. */
// PM2 ecosystem untuk runtime Bun.
//
// Berbeda dari ecosystem.config.cjs (Node), file ini memaksa PM2 menjalankan
// server standalone Next.js dengan binary Bun. PM2 sendiri dijalankan oleh
// Bun oleh install.sh, jadi Node.js tidak diperlukan.
//
// Pakai:
//   pm2 startOrReload ecosystem.bun.config.cjs
//   pm2 logs kelaska
//
// Setelah `bun --bun run build`, sinkronkan aset standalone:
//   cp -a .next/static .next/standalone/.next/static
//   cp -a public .next/standalone/public
// (install.sh --with-pm2 melakukannya otomatis.)
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(file) {
  const env = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return env;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const root = __dirname;
let pkgVersion = '';
try {
  pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version || '';
} catch {
  pkgVersion = '';
}

const env = {
  NODE_ENV: 'production',
  PORT: '3000',
  HOSTNAME: '0.0.0.0',
  ...loadEnvFile(path.join(root, '.env.local')),
};

// Server standalone chdir ke .next/standalone, jadi path relatif tidak akan
// menemukan openmaic.yml di root repo. Kirim path absolut hanya bila file-nya
// ada: OPENMAIC_CONFIG yang menunjuk file hilang membuat boot gagal, sedangkan
// tanpa file server memakai konfigurasi legacy (env / Settings).
if (!env.OPENMAIC_CONFIG) {
  const configFile = path.join(root, 'openmaic.yml');
  // String kosong (bukan undefined) juga membersihkan nilai lama yang
  // tersimpan di env proses PM2 saat installer dijalankan ulang.
  env.OPENMAIC_CONFIG = fs.existsSync(configFile) ? configFile : '';
}
// Jangan andalkan HOSTNAME dari shell PM2 (mis. ID container). Paksa bind
// semua interface; PORT tetap bisa dioverride dari .env.local.
env.HOSTNAME = '0.0.0.0';
if (!env.PORT) env.PORT = '3000';
// Endpoint health membaca npm_package_version yang biasanya diisi npm.
if (pkgVersion && !env.npm_package_version) env.npm_package_version = pkgVersion;

module.exports = {
  apps: [
    {
      name: 'kelaska',
      cwd: root,
      script: path.join(root, '.next/standalone/server.js'),
      // PM2 mendukung interpreter kustom; ini yang membuat aplikasi berjalan
      // di Bun, bukan Node. Bisa dioverride lewat OPENMAIC_BUN_BIN.
      interpreter: process.env.OPENMAIC_BUN_BIN || '/usr/local/bin/bun',
      exec_mode: 'fork',
      env,
    },
  ],
};
