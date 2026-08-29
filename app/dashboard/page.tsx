"use client";

import React, { useState } from "react";
import {
  GraduationCap,
  BookOpen,
  ClipboardList,
  Trophy,
  Clock,
  Users,
  TrendingUp,
  CalendarDays,
  Bell,
  Search,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  FileText,
  Video,
  Sparkles,
  LayoutDashboard,
  BarChart3,
  Settings,
  LogOut,
  Star,
  Target,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Mock data                                                           */
/* ------------------------------------------------------------------ */

const studentStats = [
  { label: "Kursus Aktif", value: "6", icon: BookOpen, accent: "from-indigo-500 to-blue-500" },
  { label: "Tugas Pending", value: "3", icon: ClipboardList, accent: "from-amber-500 to-orange-500" },
  { label: "Rata-rata Nilai", value: "87", icon: Trophy, accent: "from-emerald-500 to-teal-500" },
  { label: "Jam Belajar", value: "12,5 j", icon: Clock, accent: "from-purple-500 to-fuchsia-500" },
];

const studentCourses = [
  { name: "Matematika — Aljabar Linear", progress: 78, teacher: "Bu Ratna", next: "Kuis Bab 4" },
  { name: "Fisika — Dinamika Gerak", progress: 62, teacher: "Pak Budi", next: "Lab Virtual" },
  { name: "Bahasa Inggris — Academic Writing", progress: 91, teacher: "Ms. Anita", next: "Essay Draft 2" },
  { name: "Informatika — Dasar Pemrograman", progress: 45, teacher: "Pak Dimas", next: "Project PBL" },
];

const studentTasks = [
  { title: "Kuis Aljabar Linear — Bab 4", due: "Hari ini, 23:59", status: "urgent" },
  { title: "Essay Academic Writing Draft 2", due: "Besok, 12:00", status: "soon" },
  { title: "Laporan Lab Virtual Fisika", due: "15 Agu 2026", status: "normal" },
  { title: "Project PBL Informatika — Milestone 1", due: "18 Agu 2026", status: "normal" },
];

const weeklyActivity = [
  { day: "Sen", value: 45 },
  { day: "Sel", value: 70 },
  { day: "Rab", value: 55 },
  { day: "Kam", value: 90 },
  { day: "Jum", value: 65 },
  { day: "Sab", value: 30 },
  { day: "Min", value: 20 },
];

const teacherStats = [
  { label: "Total Siswa", value: "128", icon: Users, accent: "from-indigo-500 to-blue-500" },
  { label: "Kelas Aktif", value: "5", icon: BookOpen, accent: "from-emerald-500 to-teal-500" },
  { label: "Tugas Menunggu Nilai", value: "23", icon: ClipboardList, accent: "from-amber-500 to-orange-500" },
  { label: "Kehadiran Hari Ini", value: "94%", icon: TrendingUp, accent: "from-purple-500 to-fuchsia-500" },
];

const teacherClasses = [
  { name: "XII IPA 1 — Matematika", students: 32, avgScore: 84, submitted: 28, total: 32 },
  { name: "XII IPA 2 — Matematika", students: 30, avgScore: 79, submitted: 25, total: 30 },
  { name: "XI IPA 1 — Matematika", students: 33, avgScore: 88, submitted: 33, total: 33 },
  { name: "XI IPA 3 — Matematika", students: 33, avgScore: 76, submitted: 21, total: 33 },
];

const teacherTodos = [
  { title: "Nilai Kuis Bab 4 — XII IPA 1", detail: "28 dari 32 submission masuk", status: "urgent" },
  { title: "Siapkan materi Scene AI — Limit Fungsi", detail: "Dijadwalkan Senin depan", status: "soon" },
  { title: "Review Project PBL Milestone 1", detail: "12 kelompok menunggu feedback", status: "normal" },
  { title: "Rapor tengah semester", detail: "Batas input 20 Agu 2026", status: "normal" },
];

const topStudents = [
  { name: "Alya Prameswari", class: "XII IPA 1", score: 96 },
  { name: "Rizky Ramadhan", class: "XI IPA 1", score: 94 },
  { name: "Sinta Maharani", class: "XII IPA 2", score: 93 },
  { name: "Bagus Wicaksono", class: "XI IPA 1", score: 92 },
];

/* ------------------------------------------------------------------ */
/* Small components                                                    */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex items-center gap-4 hover:border-slate-700 transition-all">
      <div
        className={`w-12 h-12 rounded-xl bg-gradient-to-tr ${accent} flex items-center justify-center text-white shadow-lg shrink-0`}
      >
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-slate-400 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; cls: string; icon: React.ElementType }> = {
    urgent: { text: "Mendesak", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30", icon: AlertCircle },
    soon: { text: "Segera", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30", icon: Clock },
    normal: { text: "Terjadwal", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  };
  const s = map[status] ?? map.normal;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${s.cls}`}>
      <Icon className="w-3 h-3" />
      {s.text}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const [role, setRole] = useState<"siswa" | "guru">("siswa");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden lg:flex w-64 flex-col border-r border-slate-800/80 bg-slate-900/50 backdrop-blur-xl p-5">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <GraduationCap className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-bold text-white leading-tight">KelasKA</p>
              <p className="text-[11px] text-slate-500">Dashboard Pembelajaran</p>
            </div>
          </div>

          <nav className="space-y-1 text-sm flex-1">
            {[
              { icon: LayoutDashboard, label: "Beranda", active: true },
              { icon: BookOpen, label: role === "siswa" ? "Kursus Saya" : "Kelas Saya" },
              { icon: ClipboardList, label: role === "siswa" ? "Tugas & Kuis" : "Penilaian" },
              { icon: BarChart3, label: "Laporan" },
              { icon: CalendarDays, label: "Jadwal" },
              { icon: Settings, label: "Pengaturan" },
            ].map((item) => (
              <button
                key={item.label}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                  item.active
                    ? "bg-gradient-to-r from-indigo-600/30 to-purple-600/20 text-white border border-indigo-500/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </nav>

          <button className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all text-sm">
            <LogOut className="w-4 h-4" />
            Keluar
          </button>
        </aside>

        {/* Main */}
        <main className="flex-1 p-5 md:p-8 space-y-6 max-w-6xl mx-auto w-full">
          {/* Header */}
          <header className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                {role === "siswa" ? "Halo, Siswa! 👋" : "Halo, Guru! 👋"}
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                {role === "siswa"
                  ? "Ini ringkasan belajarmu hari ini. Tetap semangat!"
                  : "Pantau kelas, nilai tugas, dan kelola pembelajaran Anda."}
              </p>
            </div>

            {/* Role switcher */}
            <div className="flex bg-slate-900/80 p-1 rounded-2xl border border-slate-800">
              {(["siswa", "guru"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl capitalize transition-all ${
                    role === r
                      ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {r === "siswa" ? "👩‍🎓 Siswa" : "👩‍🏫 Guru"}
                </button>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  placeholder="Cari..."
                  className="bg-slate-900/80 border border-slate-800 rounded-xl py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-44"
                />
              </div>
              <button className="relative p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-white transition-all">
                <Bell className="w-4 h-4" />
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rose-500" />
              </button>
            </div>
          </header>

          {/* Stats */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {(role === "siswa" ? studentStats : teacherStats).map((s) => (
              <StatCard key={s.label} {...s} />
            ))}
          </section>

          {role === "siswa" ? (
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Courses */}
              <div className="lg:col-span-2 space-y-6">
                <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-400" />
                      Kursus Saya
                    </h2>
                    <button className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1">
                      Lihat semua <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {studentCourses.map((c) => (
                      <div
                        key={c.name}
                        className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/40 transition-all"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-white">{c.name}</p>
                          <span className="text-xs font-semibold text-indigo-300">{c.progress}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-800 overflow-hidden mb-2">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                            style={{ width: `${c.progress}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {c.teacher} · Berikutnya: <span className="text-slate-300">{c.next}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Weekly activity chart */}
                <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
                    <BarChart3 className="w-4 h-4 text-purple-400" />
                    Aktivitas Belajar Minggu Ini
                  </h2>
                  <div className="flex items-end gap-3 h-36">
                    {weeklyActivity.map((d) => (
                      <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                        <div className="w-full flex items-end justify-center h-28">
                          <div
                            className="w-full max-w-8 rounded-t-lg bg-gradient-to-t from-indigo-600/60 to-purple-500/80 hover:from-indigo-500 hover:to-purple-400 transition-all"
                            style={{ height: `${d.value}%` }}
                            title={`${d.value} menit`}
                          />
                        </div>
                        <span className="text-[11px] text-slate-500">{d.day}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Tasks */}
              <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 h-fit">
                <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
                  <Target className="w-4 h-4 text-amber-400" />
                  Tugas & Tenggat
                </h2>
                <div className="space-y-3">
                  {studentTasks.map((t) => (
                    <div
                      key={t.title}
                      className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-medium text-white leading-snug">{t.title}</p>
                        <StatusBadge status={t.status} />
                      </div>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {t.due}
                      </p>
                    </div>
                  ))}
                </div>
                <button className="mt-4 w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all inline-flex items-center justify-center gap-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  Belajar dengan AI Tutor
                </button>
              </section>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Classes table + quick actions */}
              <div className="lg:col-span-2 space-y-6">
                <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-400" />
                      Performa Kelas
                    </h2>
                    <button className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1">
                      Lihat semua <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
                          <th className="pb-2 font-medium">Kelas</th>
                          <th className="pb-2 font-medium">Siswa</th>
                          <th className="pb-2 font-medium">Rata-rata</th>
                          <th className="pb-2 font-medium">Submission</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teacherClasses.map((c) => {
                          const pct = Math.round((c.submitted / c.total) * 100);
                          return (
                            <tr key={c.name} className="border-b border-slate-800/60 last:border-0">
                              <td className="py-3 text-white font-medium">{c.name}</td>
                              <td className="py-3 text-slate-400">{c.students}</td>
                              <td className="py-3">
                                <span
                                  className={`font-semibold ${
                                    c.avgScore >= 85
                                      ? "text-emerald-400"
                                      : c.avgScore >= 78
                                        ? "text-amber-400"
                                        : "text-rose-400"
                                  }`}
                                >
                                  {c.avgScore}
                                </span>
                              </td>
                              <td className="py-3">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 w-16 rounded-full bg-slate-800 overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="text-[11px] text-slate-500">
                                    {c.submitted}/{c.total}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Quick actions */}
                <section className="grid sm:grid-cols-3 gap-4">
                  {[
                    { icon: Sparkles, label: "Buat Scene AI", desc: "Generate materi otomatis", accent: "from-indigo-500 to-purple-500" },
                    { icon: FileText, label: "Buat Kuis", desc: "Kuis interaktif cepat", accent: "from-emerald-500 to-teal-500" },
                    { icon: Video, label: "Kelas Live", desc: "Mulai sesi classroom", accent: "from-amber-500 to-orange-500" },
                  ].map((a) => (
                    <button
                      key={a.label}
                      className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/40 text-left transition-all group"
                    >
                      <div
                        className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${a.accent} flex items-center justify-center text-white mb-3 shadow-lg group-hover:scale-105 transition-transform`}
                      >
                        <a.icon className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-semibold text-white">{a.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{a.desc}</p>
                    </button>
                  ))}
                </section>
              </div>

              {/* Right column */}
              <div className="space-y-6">
                <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
                    <ClipboardList className="w-4 h-4 text-amber-400" />
                    Perlu Dikerjakan
                  </h2>
                  <div className="space-y-3">
                    {teacherTodos.map((t) => (
                      <div
                        key={t.title}
                        className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-all"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-sm font-medium text-white leading-snug">{t.title}</p>
                          <StatusBadge status={t.status} />
                        </div>
                        <p className="text-[11px] text-slate-500">{t.detail}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
                    <Star className="w-4 h-4 text-yellow-400" />
                    Siswa Terbaik Minggu Ini
                  </h2>
                  <div className="space-y-2.5">
                    {topStudents.map((s, i) => (
                      <div key={s.name} className="flex items-center gap-3">
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold ${
                            i === 0
                              ? "bg-yellow-500/20 text-yellow-400"
                              : i === 1
                                ? "bg-slate-400/20 text-slate-300"
                                : "bg-slate-800 text-slate-500"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{s.name}</p>
                          <p className="text-[11px] text-slate-500">{s.class}</p>
                        </div>
                        <span className="text-sm font-semibold text-emerald-400">{s.score}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
