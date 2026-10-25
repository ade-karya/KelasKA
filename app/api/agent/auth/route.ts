import { NextRequest } from 'next/server';

import { codexAuthLogin, codexAuthLogout, codexAuthStatus } from '@/lib/ai/codex-auth';
import { invalidateCodexModelCache } from '@/lib/ai/codex-app-server';
import { antigravityCliAuthStatus } from '@/lib/ai/antigravity-cli-auth';
import { resetDiscoveredCodexIds } from '@/lib/server/agent-runtime/opencode-models';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function GET() {
  try {
    const [codex, antigravity] = await Promise.all([
      codexAuthStatus(),
      antigravityCliAuthStatus(),
    ]);
    return apiSuccess({ codex, antigravity });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      apiKey?: string;
      provider?: string;
    };
    if (body.provider === 'antigravity') {
      // Antigravity CLI authenticates via `agy` in the user's terminal.
      return apiSuccess({ antigravity: await antigravityCliAuthStatus(), message: 'Run `agy` in your terminal to sign in.' });
    }
    const result = await codexAuthLogin(body.apiKey ?? '');
    if (!result.ok) return apiError('INVALID_CREDENTIALS', 400, result.message);
    invalidateCodexModelCache();
    resetDiscoveredCodexIds();
    return apiSuccess({ codex: await codexAuthStatus(), message: result.message });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { provider?: string };
    if (body.provider === 'antigravity') {
      return apiSuccess({ antigravity: await antigravityCliAuthStatus(), message: 'Run `agy /logout` in your terminal to sign out.' });
    }
    const result = await codexAuthLogout();
    if (!result.ok) return apiError('INVALID_CREDENTIALS', 400, result.message);
    invalidateCodexModelCache();
    resetDiscoveredCodexIds();
    return apiSuccess({ codex: await codexAuthStatus(), message: result.message });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
