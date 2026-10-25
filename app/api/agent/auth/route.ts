import { NextRequest } from 'next/server';

import { codexAuthLogin, codexAuthLogout, codexAuthStatus } from '@/lib/ai/codex-auth';
import { invalidateCodexModelCache } from '@/lib/ai/codex-app-server';
import { antigravityPythonStatus } from '@/lib/ai/antigravity-sdk';
import { resetDiscoveredCodexIds } from '@/lib/server/agent-runtime/opencode-models';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function GET() {
  try {
    const [codex, antigravity] = await Promise.all([
      codexAuthStatus(),
      antigravityPythonStatus().catch((error: unknown) => ({
        bridge: false,
        installed: false,
        authenticated: false,
        message: error instanceof Error ? error.message : 'Antigravity status unavailable.',
      })),
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
    const body = (await request.json().catch(() => ({}))) as { apiKey?: string };
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

export async function DELETE() {
  try {
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
