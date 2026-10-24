import { NextRequest } from 'next/server';

import {
  codexDeviceAuthCancel,
  codexDeviceAuthPoll,
  codexDeviceAuthStart,
} from '@/lib/ai/codex-device-auth';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function GET() {
  try {
    const result = codexDeviceAuthPoll();
    return apiSuccess(result as unknown as Record<string, unknown>);
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

export async function POST() {
  try {
    const result = await codexDeviceAuthStart();
    if (!result.ok) return apiError('INTERNAL_ERROR', 400, result.message);
    return apiSuccess(result as unknown as Record<string, unknown>);
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
    codexDeviceAuthCancel();
    return apiSuccess({ status: 'none', message: 'Cancelled.' });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
