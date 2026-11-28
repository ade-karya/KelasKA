/**
 * Ask Vercel to start the on-demand Kaggle compute node.
 *
 * Only called when `/api/auth/me` is unreachable (the named tunnel has no
 * backend). The Vercel function checks Kaggle session status before pushing a
 * new kernel version, so repeated calls from many browsers are harmless.
 */
export async function wakeComputeBackend(timeoutMs = 10_000): Promise<boolean> {
  try {
    const response = await fetch('/api/wake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
