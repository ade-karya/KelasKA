'use client';

import { useEffect, useState } from 'react';
import { Activity, Clock, MemoryStick, Hash, Loader2 } from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/stats')
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center min-h-[500px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  };

  const formatMemory = (bytes: number) => {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Dashboard Overview</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">System statistics and active access codes.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center space-x-4">
          <div className="p-3 bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400 rounded-xl">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Node Version</p>
            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">{stats?.nodeVersion || '-'}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center space-x-4">
          <div className="p-3 bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 rounded-xl">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Uptime</p>
            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {stats?.uptimeSeconds ? formatUptime(stats.uptimeSeconds) : '-'}
            </h3>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center space-x-4">
          <div className="p-3 bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400 rounded-xl">
            <MemoryStick className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Memory Usage</p>
            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {stats?.memoryUsage?.rss ? formatMemory(stats.memoryUsage.rss) : '-'}
            </h3>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center space-x-4">
          <div className="p-3 bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 rounded-xl">
            <Hash className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Active Access Codes</p>
            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {stats?.activeAccessCodes !== undefined ? `${stats.activeAccessCodes} / ${stats.totalAccessCodes}` : '-'}
            </h3>
          </div>
        </div>
      </div>
    </div>
  );
}
