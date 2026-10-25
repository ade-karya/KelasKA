import { NextRequest } from 'next/server';

import {
  cancelGoogleLogin,
  googleLoginStatus,
  googleLogout,
  setGoogleProjectLocation,
  startGoogleLogin,
  submitGoogleCode,
} from '@/lib/ai/antigravity-google-auth';
import { antigravityPythonStatus } from '@/lib/ai/antigravity-sdk';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function GET() {
  try {
    const status = googleLoginStatus();
    return apiSuccess({ google: status, antigravity: await antigravityPythonStatus() });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      code?: string;
      project?: string;
      location?: string;
    };
    if (body.project !== undefined || body.location !== undefined) {
      setGoogleProjectLocation(body.project ?? null, body.location ?? null);
    }
    if (body.action === 'start') {
      const state = startGoogleLogin();
      return apiSuccess({ google: state });
    }
    if (body.action === 'submit') {
      const state = submitGoogleCode(body.code ?? '');
      return apiSuccess({ google: state });
    }
    if (body.action === 'cancel') {
      cancelGoogleLogin();
      return apiSuccess({ google: googleLoginStatus() });
    }
    return apiError('INVALID_REQUEST', 400, 'Unknown action');
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}

export async function DELETE() {
  try {
    const result = await googleLogout();
    return apiSuccess({ google: googleLoginStatus(), message: result.message });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}
