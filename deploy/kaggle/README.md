# Deploy di Kaggle (aplikasi penuh / worker)

Profil `kaggle` menjalankan aplikasi lengkap: UI, API, runner generasi dan
agen, serta layanan GPU lokal bila notebook mendapat NVIDIA GPU. Karena itu
Kaggle bisa dipakai dua peran:

1. **Aplikasi mandiri** — buka lewat port proxy notebook.
2. **[Worker eksternal](../worker/README.md)** untuk deployment Vercel /
   Cloudflare yang memakai `DATABASE_URL` sama.

`install.sh --kaggle` juga dikenali otomatis dari `/kaggle` atau
`KAGGLE_KERNEL_RUN_TYPE`, jadi `OPENMAIC_DEPLOY_TARGET` tidak wajib diisi.

## Cell 1 — clone dan jalankan

```python
!git clone --depth 1 https://github.com/ade-karya/KelasKA.git /kaggle/temp/KelasKA
%cd /kaggle/temp/KelasKA
!bash deploy/kaggle/run.sh
```

Skrip pembungkus memanggil
`install.sh --kaggle --gpu-dir=/kaggle/temp/gpu-models`. Folder
`/kaggle/working` sengaja tidak dipakai untuk bobot model karena merupakan
output "Save Version" (kuota 20 GB).

## Cell 2 — buka aplikasi

Ikuti instruksi proxy port yang dicetak installer di akhir proses (port 3000).
Bila Kaggle tidak menyediakan proxy untuk notebook Anda, gunakan tunnel,
misalnya `cloudflared tunnel --url http://localhost:3000`, lalu buka URL yang
muncul.

## Cell 3 — jaga agar kernel tidak mati

```python
import time
while True:
    time.sleep(120)
    print("[keep-alive] kernel masih hidup", flush=True)
```

## Sebagai worker untuk Vercel/Cloudflare

Isi `.env.local` dengan [`../shared/env.worker.example`](../shared/env.worker.example)
**sebelum** menjalankan installer, terutama `DATABASE_URL` dan
`OPENMAIC_SECRET_KEY` yang sama dengan host serverless. Biarkan
`OPENMAIC_AGENT_RUNTIME_ENABLED=true` agar runner mengklaim antrean. Tidak
perlu membuka port ke publik untuk peran ini.

## Catatan

- Runtime Kaggle bersifat sementara: `data/`, `.env.local`, dan
  `openmaic.yml` hilang saat sesi dihentikan. Cadangkan `.env.local` atau pakai
  `DATABASE_URL` + `HF_S3_*` eksternal.
- Tanpa GPU, installer membiarkan endpoint GPU kosong dan memakai TTS
  browser-native. Jangan memaksa slot media ke backend yang tidak lolos health
  check—run akan gagal keras, bukan terlewati.
- Layanan GPU bisa dihidupkan ulang dengan `./scripts/gpu-services.sh`
  (idempoten) atau diperiksa dengan `--status`.
