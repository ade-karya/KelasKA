import { getSupabase } from './client';

export interface UserActivityLog {
  id?: string;
  user_id?: string | null;
  user_email?: string | null;
  action: string;
  details?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at?: string;
}

/**
 * Log a user activity into Supabase `user_activity_logs` table.
 * Fallback gracefully if table is not yet created or environment variable is unconfigured.
 */
export async function logUserActivity(params: {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const payload = {
      user_id: params.userId || null,
      user_email: params.userEmail || 'guest@anonymous',
      action: params.action,
      details: params.details || {},
      ip_address: params.ipAddress || null,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('user_activity_logs')
      .insert([payload]);

    if (error) {
      console.warn('Failed to insert activity log to Supabase:', error.message);
      if (typeof window !== 'undefined') {
        const localLogs = JSON.parse(localStorage.getItem('user_activity_logs') || '[]');
        localLogs.unshift({ ...payload, id: 'local-' + Date.now() });
        localStorage.setItem('user_activity_logs', JSON.stringify(localLogs.slice(0, 50)));
      }
      return false;
    }

    return true;
  } catch (err) {
    console.warn('Supabase client error during activity logging:', err);
    if (typeof window !== 'undefined') {
      const localLogs = JSON.parse(localStorage.getItem('user_activity_logs') || '[]');
      localLogs.unshift({
        user_id: params.userId || null,
        user_email: params.userEmail || 'guest@anonymous',
        action: params.action,
        details: params.details || {},
        created_at: new Date().toISOString(),
        id: 'local-' + Date.now(),
      });
      localStorage.setItem('user_activity_logs', JSON.stringify(localLogs.slice(0, 50)));
    }
    return false;
  }
}

/**
 * Fetch recent user activity logs from Supabase.
 */
export async function getActivityLogs(limit = 50): Promise<UserActivityLog[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('Error fetching activity logs from Supabase:', error.message);
      if (typeof window !== 'undefined') {
        return JSON.parse(localStorage.getItem('user_activity_logs') || '[]');
      }
      return [];
    }

    return (data as UserActivityLog[]) || [];
  } catch (err) {
    console.warn('Failed to fetch activity logs:', err);
    if (typeof window !== 'undefined') {
      return JSON.parse(localStorage.getItem('user_activity_logs') || '[]');
    }
    return [];
  }
}
