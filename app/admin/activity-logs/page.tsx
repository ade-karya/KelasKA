"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getActivityLogs, logUserActivity, UserActivityLog } from "@/lib/supabase/activity-logger";
import { useSupabaseAuth } from "@/lib/contexts/supabase-auth-context";
import { Activity, RefreshCw, PlusCircle, ArrowLeft, Shield, Clock, Filter, User } from "lucide-react";

export default function ActivityLogsPage() {
  const router = useRouter();
  const { user } = useSupabaseAuth();
  const [logs, setLogs] = useState<UserActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>("ALL");
  const [testAction, setTestAction] = useState("");
  const [isAddingTest, setIsAddingTest] = useState(false);

  const fetchLogs = async () => {
    setIsLoading(true);
    const data = await getActivityLogs(50);
    setLogs(data);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleAddCustomLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testAction.trim()) return;
    setIsAddingTest(true);
    await logUserActivity({
      userId: user?.id || null,
      userEmail: user?.email || "admin@demo",
      action: testAction.trim().toUpperCase().replace(/\s+/g, "_"),
      details: { trigger: "Manual Test from Admin UI", timestamp: new Date().toISOString() },
    });
    setTestAction("");
    setIsAddingTest(false);
    fetchLogs();
  };

  const filteredLogs = logs.filter((log) => {
    if (filterAction === "ALL") return true;
    return log.action.toLowerCase().includes(filterAction.toLowerCase());
  });

  const getActionBadgeColor = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes("LOGIN") || act.includes("SUCCESS")) {
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    }
    if (act.includes("LOGOUT") || act.includes("FAIL") || act.includes("ERROR")) {
      return "bg-rose-500/10 text-rose-400 border-rose-500/30";
    }
    if (act.includes("OAUTH") || act.includes("REGISTER")) {
      return "bg-purple-500/10 text-purple-400 border-purple-500/30";
    }
    return "bg-indigo-500/10 text-indigo-400 border-indigo-500/30";
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      {/* Background ambient light */}
      <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto space-y-8 relative z-10">
        
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <button
              onClick={() => router.push("/login")}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Kembali ke Login
            </button>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-600/20">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Log Aktivitas Pengguna</h1>
                <p className="text-xs text-slate-400">
                  Data real-time dari tabel <code className="text-indigo-300">user_activity_logs</code> di Supabase.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchLogs}
              disabled={isLoading}
              className="flex items-center gap-2 py-2 px-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-indigo-400" : ""}`} />
              Segarkan Data
            </button>
          </div>
        </div>

        {/* Action Panel: Filter & Manual Test Entry */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Status / Current User */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md flex items-center gap-4">
            <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400">
              <User className="w-6 h-6" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs text-slate-400">Pengguna Aktif</p>
              <p className="text-sm font-semibold text-white truncate">
                {user ? user.email : "Guest / Standalone"}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {user ? `ID: ${user.id.substring(0, 12)}...` : "Belum login Supabase Auth"}
              </p>
            </div>
          </div>

          {/* Quick Filter */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md flex flex-col justify-center">
            <label className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-indigo-400" />
              Filter Berdasarkan Aktivitas
            </label>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">Semua Aktivitas</option>
              <option value="LOGIN">Login Event</option>
              <option value="LOGOUT">Logout Event</option>
              <option value="OAUTH">OAuth Google Event</option>
              <option value="TEST">Test Activity Custom</option>
            </select>
          </div>

          {/* Add Test Log Entry */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md">
            <form onSubmit={handleAddCustomLog} className="space-y-2">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <PlusCircle className="w-3.5 h-3.5 text-purple-400" />
                Uji Tambah Activity Log
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Misal: CLICK_EXPORT_PDF"
                  value={testAction}
                  onChange={(e) => setTestAction(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={isAddingTest || !testAction.trim()}
                  className="py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition-all disabled:opacity-50"
                >
                  Kirim
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Logs Table */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">Riwayat Log Aktivitas Real-Time</h2>
            </div>
            <span className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-full">
              {filteredLogs.length} Entri Ditampilkan
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-5">Waktu</th>
                  <th className="py-3.5 px-5">User Email</th>
                  <th className="py-3.5 px-5">Aksi / Event</th>
                  <th className="py-3.5 px-5">Detail metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {isLoading ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                        <span>Memuat log dari Supabase...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500">
                      Belum ada aktivitas yang dicatat. Silakan lakukan aksi login di <code className="text-indigo-400">/login</code> atau uji dengan form di atas.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log, idx) => (
                    <tr key={log.id || idx} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-5 whitespace-nowrap text-slate-400 font-mono flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        {log.created_at ? new Date(log.created_at).toLocaleString("id-ID") : "Baru saja"}
                      </td>
                      <td className="py-3.5 px-5 font-medium text-slate-200">
                        {log.user_email || "anonymous"}
                      </td>
                      <td className="py-3.5 px-5">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${getActionBadgeColor(
                            log.action
                          )}`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-slate-400 font-mono text-[11px] max-w-xs truncate">
                        {log.details ? JSON.stringify(log.details) : "{}"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
