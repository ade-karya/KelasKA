# Runbook — KelasKA single instance (systemd + nginx + postgres, native Node)

> Scope: host ini, repo `/content/KelasKA`. JANGAN cetak secret ke log/output.
> `.env.local` (chmod 600, root-only) adalah EnvironmentFile service — BUKAN `/etc/kelaska.env`.

## 0. Prasyarat (sudah terverifikasi 2026-09-20)

- Node v22.22.2 (`/usr/local/bin/node`), Postgres 16 online `127.0.0.1:5432`, DB+role `openmaic`
- nginx `:80` site `kelaska` aktif (Cloudflare Tunnel, TLS di edge) — `nginx -t` OK
- `.env.local`: `USER_AUTH_ENABLED=true`, `MODEL_ROUTES` → `opencode-cli`,
  `OPENMAIC_AGENT_RUNTIME_MAX_CONCURRENT=8`, `OPENCODE_MAX_CONCURRENT_SPAWNS=8`,
  `TRUST_PROXY_HEADERS=true`, `PORT=3000`, `HOSTNAME=127.0.0.1`
- `next.config.ts`: `output: 'standalone'` saat non-VERCEL → artefak `.next/standalone/server.js`
- `opencode` hanya di `/root/.opencode/bin/opencode` (bukan system PATH);
  unit systemd menyuntik `PATH` eksplisit. `opencode models` OK (8 model `opencode/*-free`).
- Service jalan sebagai `root` sementara (file milik `root:root`, user `kelaska` belum ada —
  lihat komentar di `deploy/kelaska-systemd.service`). TODO: migrasi ke user khusus.
- PID 1 di kontainer ini `docker-init` (bukan systemd) — `systemctl enable --now`
  disiapkan untuk host systemd docel, JANGAN dijalankan di sini.
- `pnpm build` sedang berjalan di background oleh orang lain — JANGAN jalankan
  build/test berat paralel. Tunggu build hijau (muncul `.next/standalone/server.js`).

## 1. Urutan start (setelah build hijau)

```bash
# 1) Postgres harus online
pg_isready -h 127.0.0.1 -p 5432
sudo -u postgres psql -d openmaic -c '\dt'   # ekspektasi: "Did not find any relations" (skema lazy saat boot)

# 2) Build SUDAH jalan di background — verifikasi saja (jangan build ulang):
ls -l /content/KelasKA/.next/standalone/server.js
# bila belum ada = build belum selesai → TUNGGU, jangan start service.

# 3) Pasang unit (sekali saja / tiap ada perubahan deploy/kelaska-systemd.service)
sudo cp /content/KelasKA/deploy/kelaska-systemd.service /etc/systemd/system/kelaska.service
sudo systemd-analyze verify kelaska.service   # validasi unit tanpa start
sudo systemctl daemon-reload

# 4) Start (hanya SETELAH langkah 2 hijau)
sudo systemctl enable --now kelaska
systemctl is-active kelaska
```

Catatan nginx: site aktif `/etc/nginx/sites-enabled/kelaska` SUDAH memuat
`limit_req_zone verify` + `location = /api/auth/login` (rate-limit) + `location /api/`
dengan `gzip off`. Jangan timpa file aktif. Referensi sinkron ada di
`deploy/nginx-kelaska.conf`. Bila suatu saat edit site aktif: `sudo nginx -t && sudo systemctl reload nginx`.

## 2. Cek kesehatan pasca-start (siap salin, placeholder — tanpa secret sungguhan)

```bash
# Proses + port
systemctl is-active kelaska
ss -tlnp | grep 3000

# Health langsung + via nginx
curl -s http://127.0.0.1:3000/api/health
curl -sk https://<host>/api/health

# Runtime agent (flag + probe opencode)
curl -s http://127.0.0.1:3000/api/agent/runtime

# Auth flow (ganti *** dengan kredensial uji; username 3-32 alfanumerik, password >=8 char)
curl -s -X POST http://127.0.0.1:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"***","password":"***"}'
curl -s -c /tmp/kelaska-jar -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"***","password":"***"}'
curl -s -b /tmp/kelaska-jar http://127.0.0.1:3000/api/auth/status

# Sesi agent (butuh cookie login di atas)
curl -s -b /tmp/kelaska-jar http://127.0.0.1:3000/api/agent/sessions/status
curl -s -b /tmp/kelaska-jar http://127.0.0.1:3000/api/agent/sessions | head -c 2000
rm -f /tmp/kelaska-jar
```

Ekspektasi: `/api/health` → `{"success":true,...,"status":"ok",...}`;
`/api/agent/runtime` → `{"enabled":true,"runtimeEnabled":true,"opencode":{"available":true,...}}`.
Bila `opencode.available:false` → cek `PATH` di unit + `OPENCODE_BIN`.

## 3. Log

```bash
journalctl -u kelaska -f            # cari `runner ... started`
journalctl -u kelaska --since '15 min ago' | tail -100
# `opencode spawn antre timeout` = tambah permits/slots (lihat tuning di bawah)
sudo tail -f /var/log/nginx/kelaska_error.log
```

Tuning 20–50 chat konkuren (di `/content/KelasKA/.env.local`, lalu `sudo systemctl restart kelaska`):
`OPENMAIC_AGENT_RUNTIME_ENABLED=true`, `OPENMAIC_AGENT_RUNTIME_MAX_CONCURRENT=8..12`,
`OPENCODE_MAX_CONCURRENT_SPAWNS=8`, `OPENCODE_MAX_SPAWNS_PER_OWNER=2`, pool DB 25–30.
Skema DB dibuat otomatis via `CREATE TABLE IF NOT EXISTS` saat boot — tidak ada
perintah migrate terpisah; boot gagal bila `DATABASE_URL` ditolak.

## 4. Backup harian (pg_dump via cron, tanpa secret di crontab/output)

Jangan taruh password di crontab. Gunakan `PGPASSFILE` (chmod 600, contoh `/root/.pgpass-kelaska`
format `127.0.0.1:5432:openmaic:openmaic:***`).
Catatan 2026-09-20: `/root/.pgpass-kelaska` BELUM ada di host ini (yang ada
`/root/.kelaska-dbpass` berisi password mentah). Setup sekali (tidak mencetak secret ke output):

```bash
sudo mkdir -p /var/backups/kelaska
(printf '127.0.0.1:5432:openmaic:openmaic:'; cat /root/.kelaska-dbpass; echo) | sudo tee /root/.pgpass-kelaska >/dev/null
sudo chmod 600 /root/.pgpass-kelaska
ls -l /root/.pgpass-kelaska   # harus -rw------- root root
```

```cron
0 2 * * * PGPASSFILE=/root/.pgpass-kelaska pg_dump -h 127.0.0.1 -U openmaic openmaic | gzip > /var/backups/kelaska/kelaska-$(date +\%F).sql.gz && find /var/backups/kelaska -mtime +14 -delete
```

Restore uji berkala di staging sebelum dibutuhkan sungguhan.

## 5. Catatan operasi host ini (2026-09-20, diverifikasi)

- **Tanpa systemd**: PID 1 = docker-init. Service jalan via supervise loop
  `/etc/kelaska-run.sh` (cek `ss -tln | grep :3000`). Restart aman HANYA via
  skrip PID (/tmp/safe.sh + restart): JANGAN `pkill -f <pola>` — pola bisa
  cocok dengan shell sendiri (`$PPID` ikut cocok) dan membunuh sesi kerja.
- **Env produksi**: standalone `server.js` TIDAK me-load `.env*` di host ini
  (terbukti via /proc/PID/environ). `/etc/kelaska-run.sh` mengekspor tiap
  baris `.env.local` dengan quoting python-shlex (aman untuk JSON
  MODEL_ROUTES). `.env.production.local` ada sebagai cadangan; sumber
  kebenaran = `.env.local` (chmod 600).
- **MODEL_ROUTES**: valid hanya sebagai JSON satu baris tanpa spasi;
  `DEFAULT_MODEL` JANGAN diisi `opencode:*` (stub opencode hanya jalan lewat
  transport StreamFn + title-generator; rute LLM langsung lain akan throw).
- **Password DB** pernah terekspos di output tool saat setup → sudah dirotasi.
  Jangan pernah `cat` file secret ke output.
- **Backup**: cron pg_dump BElUM dipasang (TODO) — pasang baris cron bagian 4.
- **Registrasi**: `ALLOW_REGISTRATION=true` (self-service ratusan user).
  Matikan (`false`) bila ingin invitasi-only.

## 6. Insiden layar putih (2026-09-20) — checklist tiap deploy

Gejala: HTML 200 tapi semua `/_next/static/*` 404 → halaman putih.
Sebab: standalone `server.js` hanya serve static dari
`.next/standalone/.next/static`, yang TIDAK ikut ter-copy oleh `next build`,
dan path di-resolve saat STARTUP (copy belakangan tidak mempan tanpa restart).
Alur wajib tiap build baru:
```bash
pnpm build
./deploy/sync-standalone-static.sh   # copy .next/static → standalone
# lalu restart service (skrip PID aman di /tmp/safe.sh + restart)
curl -s -o /dev/null -w "[%{http_code}]\n" http://127.0.0.1:3000/_next/static/chunks/<satu-chunk-dari-HTML>
```

## 7. OpenCode sebagai LLM workbench + pembuatan kelas (2026-09-20)

`MODEL_ROUTES` me-route 13 stage teks + `DEFAULT_MODEL=opencode:default`
(api `opencode-cli` di semua stage). Cara kerja upstream tidak berubah:
- `maic-agent-driver` tetap satu-satunya stage tanpa fallback; tools tetap
  milik pi loop; opencode hanya emit max 1 tool-call per turn (fenced JSON).
- Stage isi materi (`scene-content:*`, outlines, actions, quiz, pbl, titles)
  lewat cabang opencode di `lib/ai/llm.ts` (`callLLM`/`streamLLM`), jadi
  pembuatan kelas jalan tanpa API key vendor.
- Spawn default di scratch dir (`OPENCODE_WORKDIR` untuk override), bukan repo.
- Jangan set `thinking.effort` untuk stage opencode apa pun.
