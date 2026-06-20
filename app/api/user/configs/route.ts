import { cookies } from 'next/headers';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { verifyAccessToken } from '@/app/api/access-code/verify/route';
import { createAdminClient } from '@/utils/supabase/admin';

export async function GET(request: Request) {
  const accessCode = process.env.ACCESS_CODE;
  const enabled = !!accessCode;

  // 1. Verify Access Code if enabled
  if (enabled) {
    const cookieStore = await cookies();
    const token = cookieStore.get('kelaska_access')?.value;
    const authenticated = !!token && verifyAccessToken(token, accessCode);
    if (!authenticated) {
      return apiError('INVALID_REQUEST', 401, 'Unauthorized access code required');
    }
  }

  // 2. Get email parameter
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  if (!email) {
    return apiError('INVALID_REQUEST', 400, 'Email parameter is required');
  }

  try {
    const supabase = createAdminClient();

    // 3. Find active user
    const { data: user, error: userError } = await supabase
      .from('admin_users')
      .select('id, email, is_active')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (userError || !user) {
      return apiSuccess({ exists: false, configs: [] });
    }

    if (!user.is_active) {
      return apiError('INVALID_REQUEST', 403, 'User account is deactivated');
    }

    // 4. Fetch all user configurations
    const { data: configs, error: configsError } = await supabase
      .from('user_provider_configs')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_enabled', true);

    if (configsError) {
      throw configsError;
    }

    return apiSuccess({ exists: true, configs });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}
