// PM2 ecosystem untuk produksi lokal: menjalankan server standalone Next.js
// (output: 'standalone') sehingga warning "next start does not work with
// output: standalone" hilang. Env runtime dimuat dari .env.local karena
// server.js standalone chdir ke .next/standalone dan tidak membaca file .env
// di root. Setelah setiap `npm run build`, sinkronkan ulang dengan:
//   cp -r .next/static .next/standalone/.next/static
//   cp -r public .next/standalone/public
// (`install.sh --with-pm2` melakukannya otomatis.)
// openmaic.yml dibaca via OPENMAIC_CONFIG absolut di bawah (server standalone
// chdir ke .next/standalone); install.sh juga menyalinnya ke
// .next/standalone/openmaic.yml sebagai cadangan.
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
    env[key] = trimmed.slice(eq + 1).trim();
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
// openmaic.yml dibaca server via process.cwd() — dan server standalone
// chdir ke .next/standalone (lihat server.js: process.chdir(__dirname)),
// sehingga tanpa ini file di root repo TIDAK terbaca dan slot resolution
// jatuh ke legacy config (lihat log "[ModelConfig] comes from the legacy...").
// OPENMAIC_CONFIG absolut membuat deployment layer selalu ketemu.
// (Sebelumnya komentar di sini mengklaim symlink, tapi file tidak ada di
// .next/standalone/ — itulah kenapa slot `agent` dari install.sh tidak aktif
// di PM2 dan diskusi tetap pakai workspace llm=google.)
if (!env.OPENMAIC_CONFIG) {
  env.OPENMAIC_CONFIG = path.join(root, 'openmaic.yml');
}
// Health endpoint reads npm_package_version (normally set by npm run start).
if (pkgVersion && !env.npm_package_version) env.npm_package_version = pkgVersion;

module.exports = {
  apps: [
    {
      name: 'kelaska',
      cwd: root,
      script: './.next/standalone/server.js',
      env,
    },
  ],
};
