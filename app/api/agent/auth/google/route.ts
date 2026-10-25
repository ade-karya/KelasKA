import { NextRequest } from 'next/server';

import { antigravityCliAuthStatus } from '@/lib/ai/antigravity-cli-auth';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function GET() {
  try {
    return apiSuccess({ antigravity: await antigravityCliAuthStatus() });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}

export async function POST(request: NextRequest) {
  return apiSuccess({ antigravity: await antigravityCliAuthStatus(), message: 'Run `agy` in your terminal to sign in.' });
}

export async function DELETE() {
  return apiSuccess({ antigravity: await antigravityCliAuthStatus(), message: 'Run `agy /logout` in your terminal to sign out.' });
}
