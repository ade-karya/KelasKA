'use client';

/**
 * Global Error Boundary — catches unhandled errors in the root layout.
 * This is the last line of defense before Next.js shows its generic error page.
 * Must render its own <html> and <body> since the root layout may have crashed.
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          color: '#e2e8f0',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: '90%',
            textAlign: 'center',
            padding: '3rem 2rem',
            borderRadius: '1.5rem',
            background: 'rgba(30, 27, 75, 0.6)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(139, 92, 246, 0.2)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Icon */}
          <div
            style={{
              width: 64,
              height: 64,
              margin: '0 auto 1.5rem',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
            }}
          >
            ⚠️
          </div>

          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              marginBottom: '0.75rem',
              background: 'linear-gradient(135deg, #c084fc, #818cf8)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Terjadi Kesalahan
          </h1>

          <p
            style={{
              fontSize: '0.9rem',
              color: '#94a3b8',
              lineHeight: 1.6,
              marginBottom: '2rem',
            }}
          >
            Aplikasi mengalami error yang tidak terduga. Silakan coba muat ulang halaman.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '0.75rem',
                border: 'none',
                background: 'linear-gradient(135deg, #7c3aed, #6366f1)',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
                transition: 'opacity 0.2s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
            >
              Coba Lagi
            </button>

            <button
              onClick={() => {
                // Clear potentially corrupted state and reload
                try {
                  sessionStorage.clear();
                } catch {
                  /* ignore */
                }
                window.location.href = '/';
              }}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '0.75rem',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                background: 'transparent',
                color: '#94a3b8',
                fontWeight: 500,
                fontSize: '0.875rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(148, 163, 184, 0.1)';
                e.currentTarget.style.color = '#e2e8f0';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#94a3b8';
              }}
            >
              Muat Ulang
            </button>
          </div>

          {/* Error details for debugging */}
          <details
            style={{
              marginTop: '1.5rem',
              textAlign: 'left',
            }}
          >
            <summary
              style={{
                fontSize: '0.7rem',
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              Detail teknis {error.digest && `(${error.digest})`}
            </summary>
            <pre
              style={{
                marginTop: '0.5rem',
                padding: '0.75rem',
                borderRadius: '0.5rem',
                background: 'rgba(0, 0, 0, 0.3)',
                fontSize: '0.65rem',
                color: '#94a3b8',
                overflow: 'auto',
                maxHeight: 160,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'monospace',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        </div>
      </body>
    </html>
  );
}
