import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/admin';

function isAuthenticated(request: NextRequest): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionCookie = request.cookies.get('admin_session')?.value;
  return !!adminPassword && sessionCookie === adminPassword;
}

/** GET /api/admin/users/[id]/configs — Get all provider configs for user */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('user_provider_configs')
    .select('*')
    .eq('user_id', id)
    .order('category', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ configs: data || [] });
}

/** PUT /api/admin/users/[id]/configs — Upsert provider configs for user */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { configs } = body;

    if (!Array.isArray(configs)) {
      return NextResponse.json(
        { error: 'configs must be an array' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Verify user exists
    const { data: user } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', id)
      .single();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Delete existing configs for this user and re-insert
    // This is simpler than individual upserts for bulk operations
    await supabase
      .from('user_provider_configs')
      .delete()
      .eq('user_id', id);

    if (configs.length > 0) {
      const rows = configs.map((cfg: Record<string, unknown>) => ({
        user_id: id,
        category: cfg.category,
        provider_id: cfg.provider_id,
        api_key: cfg.api_key || '',
        base_url: cfg.base_url || '',
        models: cfg.models || [],
        is_enabled: cfg.is_enabled !== false,
        extra_config: cfg.extra_config || {},
      }));

      const { error: insertError } = await supabase
        .from('user_provider_configs')
        .insert(rows);

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    // Fetch and return updated configs
    const { data: updatedConfigs } = await supabase
      .from('user_provider_configs')
      .select('*')
      .eq('user_id', id)
      .order('category', { ascending: true });

    return NextResponse.json({ configs: updatedConfigs || [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 }
    );
  }
}
