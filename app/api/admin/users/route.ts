import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/admin';

/** Verify admin session from cookie */
function isAuthenticated(request: NextRequest): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionCookie = request.cookies.get('admin_session')?.value;
  return !!adminPassword && sessionCookie === adminPassword;
}

/** GET /api/admin/users — List all users with config counts */
export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();

    const { data: users, error } = await supabase
      .from('admin_users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get config counts per user
    const { data: configCounts } = await supabase
      .from('user_provider_configs')
      .select('user_id');

    const countMap: Record<string, number> = {};
    configCounts?.forEach((c) => {
      countMap[c.user_id] = (countMap[c.user_id] || 0) + 1;
    });

    const usersWithStats = (users || []).map((user) => ({
      ...user,
      config_count: countMap[user.id] || 0,
    }));

    return NextResponse.json({ users: usersWithStats });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 }
    );
  }
}

/** POST /api/admin/users — Create a new user */
export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { email, name, role = 'user', is_active = true } = body;

    if (!email || !name) {
      return NextResponse.json(
        { error: 'Email and name are required' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('admin_users')
      .insert({ email, name, role, is_active })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A user with this email already exists' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ user: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 }
    );
  }
}
