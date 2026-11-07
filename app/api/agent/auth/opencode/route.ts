import { NextRequest } from 'next/server';

import {
  opencodeDeviceAuthCancel,
  opencodeDeviceAuthPoll,
  opencodeDeviceAuthStart,
} from '@/lib/ai/opencode-device-auth';
import { invalidateOpencodeAuthCache, opencodeAuthStatus } from '@/lib/ai/opencode-auth';
import { invalidateOpencodeModelCache } from '@/lib/ai/opencode-cli-models';
import { resetDiscoveredOpencodeIds } from '@/lib/server/agent-runtime/opencode-models';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export const runtime = 'nodejs';

/** After a successful sign-in: drop every cache that assumed "logged out". */
function invalidateAfterLogin() {
  invalidateOpencodeAuthCache();
  invalidateOpencodeModelCache();
  resetDiscoveredOpencodeIds();
}

export async function GET() {
  try {
    const login = opencodeDeviceAuthPoll();
    if (login.status === 'success') invalidateAfterLogin();
    return apiSuccess({ login, auth: await opencodeAuthStatus() });
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
      action?: string;
    };
    if (body.action === 'start') {
      const login = await opencodeDeviceAuthStart();
      return apiSuccess({ login, auth: await opencodeAuthStatus() });
    }
    if (body.action === 'cancel') {
      opencodeDeviceAuthCancel();
      return apiSuccess({
        login: opencodeDeviceAuthPoll(),
        auth: await opencodeAuthStatus(),
      });
    }
    return apiError('INVALID_REQUEST', 400, 'Unknown action');
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
