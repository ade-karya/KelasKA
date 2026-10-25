import { NextRequest } from 'next/server';

import {
  cancelAntigravityCliLogin,
  getAntigravityCliLoginStatus,
  startAntigravityCliLogin,
  submitAntigravityCliLoginCode,
  waitForAntigravityCliLoginUrl,
} from '@/lib/ai/antigravity-cli-login';
import { antigravityCliAuthStatus } from '@/lib/ai/antigravity-cli-auth';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { invalidateAntigravityModelCache } from '@/lib/ai/antigravity-cli-models';
import { resetDiscoveredAntigravityIds } from '@/lib/server/agent-runtime/opencode-models';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const status = getAntigravityCliLoginStatus();
    const url = status.url ?? (status.active ? await waitForAntigravityCliLoginUrl(2000) : null);
    const auth = await antigravityCliAuthStatus();
    return apiSuccess({ login: { ...status, url }, auth });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      code?: string;
    };
    if (body.action === 'start') {
      startAntigravityCliLogin();
      const url = await waitForAntigravityCliLoginUrl(8000);
      const status = getAntigravityCliLoginStatus();
      return apiSuccess({ login: { ...status, url }, auth: await antigravityCliAuthStatus() });
    }
    if (body.action === 'submit') {
      const result = submitAntigravityCliLoginCode(body.code ?? '');
      const auth = await antigravityCliAuthStatus();
      if (auth.authenticated) {
        invalidateAntigravityModelCache();
        resetDiscoveredAntigravityIds();
      }
      return apiSuccess({ login: getAntigravityCliLoginStatus(), auth, message: result.message, ok: result.ok });
    }
    if (body.action === 'cancel') {
      cancelAntigravityCliLogin();
      return apiSuccess({ login: getAntigravityCliLoginStatus(), auth: await antigravityCliAuthStatus() });
    }
    return apiError('INVALID_REQUEST', 400, 'Unknown action');
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}
