# Deploy di Google Colab (aplikasi penuh / worker)

Profil `colab` menjalankan aplikasi lengkap dengan build produksi + PM2 dan
seluruh feature flag aplikasi. Sama seperti Kaggle, Colab bisa menjadi
aplikasi mandiri maupun **[worker eksternal](../worker/README.md)** untuk
Vercel/Cloudflare.

Jangan menggabungkan `--colab` dengan `--dev` (keduanya memakai port 3000).

## Cell 1 — clone dan install

```python
!git clone --depth 1 https://github.com/ade-karya/KelasKA.git /content/KelasKA
%cd /content/KelasKA
!bash deploy/colab/run.sh
```

Pembungkusnya memanggil `install.sh --colab`. Build pertama memakan sekitar
10–15 menit di runtime 2 vCPU; menjalankan ulang tanpa perubahan sumber jauh
lebih cepat karena installer membandingkan fingerprint build.

Bila runtime mendapat NVIDIA GPU, installer otomatis menjalankan
`scripts/gpu-services.sh` dan hanya menulis endpoint yang lolos health check.
Tanpa GPU, TTS memakai `browser-native-tts`.

## Cell 2 — buka aplikasi

```python
from google.colab import output
output.serve_kernel_port_as_window(3000)
```

Atau, untuk panel di dalam notebook:

```python
from google.colab import output
output.serve_kernel_port_as_iframe(3000)
```

## Cell 3 — anti-idle

Colab mematikan runtime yang menganggur. Biarkan satu cell ini berjalan:

```python
import time
from IPython.display import display, Javascript

display(Javascript("""
(function () {
  const tick = () => {
    try {
      document.querySelectorAll(
        'colab-connect-button, colab-toolbar-button, button[aria-label*="Connect" i], button[aria-label*="Reconnect" i]'
      ).forEach((el) => el && el.click());
    } catch (e) { console.warn('[keep-alive]', e); }
  };
  tick();
  setInterval(tick, 30000);
})();
"""))

while True:
    time.sleep(120)
    print("[keep-alive] kernel heartbeat", time.strftime('%H:%M:%S'), flush=True)
```

## Sebagai worker untuk Vercel/Cloudflare

Isi env dari [`../shared/env.worker.example`](../shared/env.worker.example)
dengan `DATABASE_URL` dan `OPENMAIC_SECRET_KEY` yang sama dengan host
serverless, lalu jalankan cell install seperti di atas. Biarkan
`OPENMAIC_AGENT_RUNTIME_ENABLED=true`. Tidak perlu membuka port 3000 ke publik.

## Catatan

- Runtime Colab episodik. Cadangkan `.env.local` dan `openmaic.yml` sebelum
  menutup tab, atau pakai database dan byte store eksternal.
- `install.sh --colab` tidak memasang Ollama/local LLM; chat memakai Gemini.
  Ollama lokal hanya ikut bila `--with-gpu` eksplisit.
- Log aplikasi: `pm2 logs kelaska`.
