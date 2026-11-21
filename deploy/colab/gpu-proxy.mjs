#!/usr/bin/env node
/**
 * A tiny loopback reverse proxy for the Colab app.
 *
 * The app's GPU providers are configured with plain base URLs (openmaic.yml)
 * and have no place to attach Cloudflare Access service-token headers. This
 * proxy gives them a local, header-free address:
 *
 *   IMAGE_COMFYUI  -> http://127.0.0.1:8787/comfyui
 *   ASR_FUNASR     -> http://127.0.0.1:8787/asr
 *   TTS_VOXCPM     -> http://127.0.0.1:8787/tts
 *   OLLAMA         -> http://127.0.0.1:8787/ollama
 *
 * It forwards to the Access-protected `gpu.` tunnel with the service token,
 * streaming both directions (multipart audio, image responses, SSE).
 */
import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.KELASKA_GPU_PROXY_PORT || 8787);
const HOST = process.env.KELASKA_GPU_PROXY_HOST || '127.0.0.1';
const GPU_ORIGIN = process.env.KELASKA_GPU_ORIGIN || 'https://gpu.kelaska.riau.ai';
const ACCESS_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const ACCESS_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

const PREFIXES = ['/comfyui', '/tts', '/asr', '/ollama'];
const base = new URL(GPU_ORIGIN);
const basePath = base.pathname.replace(/\/$/, '');

function accessHeaders() {
  if (!ACCESS_ID || !ACCESS_SECRET) return {};
  return {
    'CF-Access-Client-Id': ACCESS_ID,
    'CF-Access-Client-Secret': ACCESS_SECRET,
  };
}

function targetFor(pathname, search) {
  if (pathname === '/health' || pathname === '/healthz') {
    return new URL(`${basePath}/health`, base);
  }
  const prefix = PREFIXES.find(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
  if (!prefix) return null;
  const rest = pathname.slice(prefix.length) || '/';
  return new URL(`${basePath}${prefix}${rest}${search}`, base);
}

const server = http.createServer((req, res) => {
  const incoming = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const target = targetFor(incoming.pathname, incoming.search);
  if (!target) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'unknown GPU proxy path' }));
    return;
  }

  const headers = { ...req.headers, ...accessHeaders() };
  delete headers.host;
  delete headers.connection;
  headers['x-forwarded-host'] = req.headers.host || '127.0.0.1';
  headers['x-kelaska-colab-proxy'] = '1';

  const client = target.protocol === 'https:' ? https : http;
  const proxyReq = client.request(
    target,
    {
      method: req.method,
      headers,
      timeout: 15 * 60 * 1000,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('GPU upstream timed out'));
  });
  proxyReq.on('error', (error) => {
    console.error(
      `[gpu-proxy] ${req.method} ${incoming.pathname} -> ${target.href}: ${error.message}`,
    );
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ ok: false, error: error.message }));
  });

  console.log(`[gpu-proxy] ${req.method} ${incoming.pathname} -> ${target.href}`);
  req.pipe(proxyReq);
});

server.listen(PORT, HOST, () => {
  console.log(`[gpu-proxy] listening on http://${HOST}:${PORT} -> ${GPU_ORIGIN}`);
  if (!ACCESS_ID || !ACCESS_SECRET) {
    console.warn('[gpu-proxy] CF_ACCESS_CLIENT_ID/SECRET are empty; gpu. must not require Access.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[gpu-proxy] ${signal}; shutting down`);
    server.close(() => process.exit(0));
  });
}
