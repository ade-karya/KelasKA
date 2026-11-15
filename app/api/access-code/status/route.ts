import { cookies } from 'next/headers';
import { apiSuccess } from '@/lib/server/api-response';
import { verifyAccessToken } from '@/lib/server/access-token';
import { authEnabled } from '@/lib/server/auth/config';

export async function GET() {
  // With accounts on, the session is the gate: the access-code modal must not
  // sit on top of a login page that already authenticated the browser.
  if (authEnabled()) return apiSuccess({ enabled: false, authenticated: true });

  const accessCode = process.env.ACCESS_CODE;
  const enabled = !!accessCode;

  let authenticated = false;
  if (enabled) {
    const cookieStore = await cookies();
    const token = cookieStore.get('openmaic_access')?.value;
    authenticated = !!token && verifyAccessToken(token, accessCode);
  }

  return apiSuccess({ enabled, authenticated });
}
