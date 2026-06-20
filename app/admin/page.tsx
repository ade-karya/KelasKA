import { createAdminClient } from '@/utils/supabase/admin';
import { StatsCard } from '@/components/admin/stats-card';
import { Users, UserCheck, ShieldAlert, Settings } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const supabase = createAdminClient();

  const { count: totalUsers } = await supabase
    .from('admin_users')
    .select('*', { count: 'exact', head: true });

  const { count: activeUsers } = await supabase
    .from('admin_users')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  const { count: totalConfigs } = await supabase
    .from('user_provider_configs')
    .select('*', { count: 'exact', head: true });

  const { data: recentUsers } = await supabase
    .from('admin_users')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard Overview</h1>
        <p className="text-slate-400 mt-2">Manage your platform users and AI provider configurations.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Users"
          value={totalUsers || 0}
          icon={Users}
        />
        <StatsCard
          title="Active Users"
          value={activeUsers || 0}
          icon={UserCheck}
        />
        <StatsCard
          title="Total Configs"
          value={totalConfigs || 0}
          icon={Settings}
        />
        <StatsCard
          title="System Status"
          value="Healthy"
          icon={ShieldAlert}
        />
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">Recently Added Users</h2>
          <Button asChild variant="outline" className="bg-white/5 border-white/10 text-white hover:bg-white/10">
            <Link href="/admin/users">View All</Link>
          </Button>
        </div>
        
        <div className="bg-white/5 border border-white/10 rounded-xl backdrop-blur-xl overflow-hidden">
          <div className="divide-y divide-white/10">
            {recentUsers?.map((user) => (
              <div key={user.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-white/5 transition-colors gap-4 sm:gap-0">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400 font-bold flex-shrink-0">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-200 truncate">{user.name}</p>
                    <p className="text-sm text-slate-500 truncate">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 self-start sm:self-auto">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                    user.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                  }`}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-white/10">
                    <Link href={`/admin/users/${user.id}`}>Edit</Link>
                  </Button>
                </div>
              </div>
            ))}
            {(!recentUsers || recentUsers.length === 0) && (
              <div className="p-8 text-center text-slate-500">
                No users found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
