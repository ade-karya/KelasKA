"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  Menu,
  X,
  LogIn,
  ShieldCheck,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useStudentAuth } from "@/lib/contexts/student-auth-context";
import { useSupabaseAuth } from "@/lib/contexts/supabase-auth-context";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type CourseRow = { name: string; progress: number; teacher: string; next: string };
type TaskRow = { id?: string; title: string; due: string; dueRaw?: string; status: "urgent" | "soon" | "normal" };
type WeeklyRow = { day: string; value: number; minutes?: number };
type ClassPerf = { name: string; className: string; students: number; avgScore: number; submitted: number; total: number };
type TodoRow = { id?: string; title: string; detail: string; status: "urgent" | "soon" | "normal" };

interface SiswaData {
  role: "siswa";
  student: { id: string; name?: string; class_name?: string } | null;
  stats: { kursusAktif: number; tugasPending: number; rataRata: string; jamBelajar: string };
  courses: CourseRow[];
  tasks: TaskRow[];
  weeklyActivity: WeeklyRow[];
  notices: TaskRow[];
}
interface GuruData {
  role: "guru";
  stats: { totalStudents: string; kelasAktif: string; tugasMenunggu: string; kehadiran: string };
  classesPerf: ClassPerf[];
  todos: TodoRow[];
  topStudents: { id: string; name: string; class: string; score: number; avatar?: string }[];
  assignments: { id: string; title: string; class_name: string; due_date: string; status: string }[];
}
type DashboardData = SiswaData | GuruData;

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
      <div className="min-w-0">
        <p className="text-2xl font-bold text-white truncate">{value}</p>
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

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-800 rounded ${className}`} />;
}

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const router = useRouter();
  const { student, loading: loadingStudent, logout: studentLogout, token } = useStudentAuth();
  const { user, loading: loadingSupabase, signOut: supabaseSignOut } = useSupabaseAuth();

  const authLoading = loadingStudent || loadingSupabase;
  const isStudentAuthed = !!student;
  const isGuruAuthed = !!user && !student; // student takes precedence

  const [role, setRole] = useState<"siswa" | "guru">("siswa");
  const [search, setSearch] = useState("");
  const [showNotif, setShowNotif] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [activeNav, setActiveNav] = useState("Beranda");
  const [showSettings, setShowSettings] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [changing, setChanging] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);

  // derive effective role from auth – lock it when authenticated
  useEffect(() => {
    if (authLoading) return;
    if (isStudentAuthed) setRole("siswa");
    else if (isGuruAuthed) setRole("guru");
  }, [authLoading, isStudentAuthed, isGuruAuthed]);

  const canSwitchRole = !authLoading && !isStudentAuthed && !isGuruAuthed;

  const [data, setData] = useState<DashboardData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const fetchData = async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const params = new URLSearchParams({ role });
      if (student?.id) params.set("studentId", student.id);
      if (student?.class_name) params.set("className", student.class_name);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/dashboard?${params.toString()}`, { headers, cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Gagal memuat dashboard");
      setData(json);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setDataError(msg);
      toast.error(msg);
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, student?.id, token, authLoading]);

  // close notif on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleLogout = async () => {
    try {
      if (isStudentAuthed) {
        studentLogout();
        toast.success("Berhasil keluar");
        router.push("/login-siswa");
      } else if (isGuruAuthed) {
        await supabaseSignOut();
        toast.success("Berhasil keluar");
        router.push("/login");
      } else {
        // preview mode
        setRole("siswa");
        toast.info("Keluar dari pratinjau");
        router.push("/");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal keluar");
    }
  };

  const handleNav = (label: string) => {
    setActiveNav(label);
    setMobileNav(false);
    const map: Record<string, { action: () => void }> = {
      Beranda: { action: () => {} },
      "Kursus Saya": { action: () => router.push("/materi") },
      "Kelas Saya": { action: () => router.push("/kelas") },
      "Materi Saya": { action: () => router.push("/materi") },
      Studio: { action: () => router.push("/studio") },
      "Tugas & Kuis": { action: () => { document.getElementById("tugas-section")?.scrollIntoView({ behavior: "smooth" }); } },
      Penilaian: { action: () => router.push("/penilaian") },
      Nilai: { action: () => router.push("/penilaian") },
      Pengaturan: { action: () => setShowSettings(true) },
    };
    const entry = map[label];
    if (entry) entry.action();
    else {
      // No toast for missing nav — sidebar only contains live items per PRD §5.2
      router.push("/dashboard");
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!search.trim()) {
      toast.info("Masukkan kata kunci untuk mencari kursus atau tugas");
      return;
    }
    // scroll to relevant section
    const el = document.getElementById(role === "siswa" ? "kursus-section" : "kelas-section");
    el?.scrollIntoView({ behavior: "smooth" });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) {
      toast.error("Hanya siswa yang dapat mengganti kata sandi di sini");
      return;
    }
    if (newPwd.length < 6) {
      toast.error("Kata sandi baru minimal 6 karakter");
      return;
    }
    setChanging(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Gagal mengganti kata sandi");
      toast.success("Kata sandi berhasil diubah");
      setChangePwdOpen(false);
      setOldPwd("");
      setNewPwd("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setChanging(false);
    }
  };

  /* derived filtered data */
  const q = search.trim().toLowerCase();

  const siswaCourses: CourseRow[] = useMemo(() => {
    if (!data || data.role !== "siswa") return [];
    if (!q) return data.courses;
    return data.courses.filter((c) => c.name.toLowerCase().includes(q) || c.teacher.toLowerCase().includes(q));
  }, [data, q]);

  const siswaTasks: TaskRow[] = useMemo(() => {
    if (!data || data.role !== "siswa") return [];
    if (!q) return data.tasks;
    return data.tasks.filter((t) => t.title.toLowerCase().includes(q));
  }, [data, q]);

  const guruClasses: ClassPerf[] = useMemo(() => {
    if (!data || data.role !== "guru") return [];
    if (!q) return data.classesPerf;
    return data.classesPerf.filter((c) => c.name.toLowerCase().includes(q) || c.className.toLowerCase().includes(q));
  }, [data, q]);

  const guruTodos: TodoRow[] = useMemo(() => {
    if (!data || data.role !== "guru") return [];
    if (!q) return data.todos;
    return data.todos.filter((t) => t.title.toLowerCase().includes(q));
  }, [data, q]);

  const notifItems: { title: string; sub: string; status?: string }[] = useMemo(() => {
    if (!data) return [];
    if (data.role === "siswa") return data.tasks.slice(0, 4).map((t) => ({ title: t.title, sub: t.due, status: t.status }));
    return data.todos.slice(0, 4).map((t) => ({ title: t.title, sub: t.detail, status: t.status }));
  }, [data]);

  const urgentCount = useMemo(() => notifItems.filter((n) => n.status === "urgent").length || notifItems.length, [notifItems]);

  // stats for display
  const statCards = useMemo(() => {
    if (dataLoading || !data) return null;
    if (data.role === "siswa") {
      return [
        { label: "Kursus Aktif", value: String(data.stats.kursusAktif), icon: BookOpen, accent: "from-indigo-500 to-blue-500" },
        { label: "Tugas Pending", value: String(data.stats.tugasPending), icon: ClipboardList, accent: "from-amber-500 to-orange-500" },
        { label: "Rata-rata Nilai", value: String(data.stats.rataRata), icon: Trophy, accent: "from-emerald-500 to-teal-500" },
        { label: "Jam Belajar", value: String(data.stats.jamBelajar), icon: Clock, accent: "from-purple-500 to-fuchsia-500" },
      ];
    } else {
      return [
        { label: "Total Siswa", value: data.stats.totalStudents, icon: Users, accent: "from-indigo-500 to-blue-500" },
        { label: "Kelas Aktif", value: data.stats.kelasAktif, icon: BookOpen, accent: "from-emerald-500 to-teal-500" },
        { label: "Tugas Menunggu Nilai", value: data.stats.tugasMenunggu, icon: ClipboardList, accent: "from-amber-500 to-orange-500" },
        { label: "Kehadiran Hari Ini", value: data.stats.kehadiran, icon: TrendingUp, accent: "from-purple-500 to-fuchsia-500" },
      ];
    }
  }, [data, dataLoading]);

  const showAuthGate = !authLoading && !isStudentAuthed && !isGuruAuthed;
  useEffect(() => {
    if (showAuthGate) {
      router.replace('/masuk?next=/dashboard');
    }
  }, [showAuthGate, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <p className="text-sm text-slate-400">Memuat sesi...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex min-h-screen">
        {/* Sidebar – desktop */}
        <aside className="hidden lg:flex w-64 flex-col border-r border-slate-800/80 bg-slate-900/50 backdrop-blur-xl p-5 sticky top-0 h-screen">
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
            {(
              role === "siswa"
                ? [
                    { icon: LayoutDashboard, label: "Beranda", href: "/dashboard" },
                    { icon: BookOpen, label: "Kursus Saya", href: "/materi" },
                    { icon: ClipboardList, label: "Tugas & Kuis", href: "/penilaian" },
                    { icon: Trophy, label: "Nilai", href: "/penilaian" },
                    { icon: Settings, label: "Pengaturan", href: "/dashboard" },
                  ]
                : [
                    { icon: LayoutDashboard, label: "Beranda", href: "/dashboard" },
                    { icon: Sparkles, label: "Studio", href: "/studio" },
                    { icon: BookOpen, label: "Materi Saya", href: "/materi" },
                    { icon: Users, label: "Kelas Saya", href: "/kelas" },
                    { icon: ClipboardList, label: "Penilaian", href: "/penilaian" },
                    { icon: Settings, label: "Pengaturan", href: "/dashboard" },
                  ]
            ).map((item) => (
              <button
                key={item.label}
                onClick={() => handleNav(item.label)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                  activeNav === item.label || (item.label === "Beranda" && activeNav === "Beranda")
                    ? "bg-gradient-to-r from-indigo-600/30 to-purple-600/20 text-white border border-indigo-500/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="pt-4 border-t border-slate-800/80 space-y-3">
            {isStudentAuthed && student && (
              <div className="flex items-center gap-3 p-2 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <img src={student.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${student.name}`} alt={student.name} className="w-8 h-8 rounded-full bg-slate-700" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-white truncate">{student.name}</p>
                  <p className="text-[10px] text-slate-500 truncate">{student.nisn} · {student.class_name ?? "Tanpa kelas"}</p>
                </div>
              </div>
            )}
            {isGuruAuthed && user && (
              <div className="flex items-center gap-3 p-2 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                  {(user.email?.[0] ?? "G").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-white truncate">{user.email}</p>
                  <p className="text-[10px] text-slate-500">Guru / Admin</p>
                </div>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all text-sm"
            >
              <LogOut className="w-4 h-4" />
              {isStudentAuthed || isGuruAuthed ? "Keluar" : "Keluar Pratinjau"}
            </button>
          </div>
        </aside>

        {/* Mobile overlay nav */}
        {mobileNav && (
          <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNav(false)}>
            <div
              className="w-72 max-w-[85vw] h-full bg-slate-900 border-r border-slate-800 p-5 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center">
                    <GraduationCap className="w-6 h-6 text-white" />
                  </div>
                  <p className="font-bold text-white">KelasKA</p>
                </div>
                <button onClick={() => setMobileNav(false)} className="p-2 rounded-xl bg-slate-800 text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="space-y-1 flex-1">
                {(
                  role === "siswa"
                    ? [
                        { icon: LayoutDashboard, label: "Beranda" },
                        { icon: BookOpen, label: "Kursus Saya" },
                        { icon: ClipboardList, label: "Tugas & Kuis" },
                        { icon: Trophy, label: "Nilai" },
                        { icon: Settings, label: "Pengaturan" },
                      ]
                    : [
                        { icon: LayoutDashboard, label: "Beranda" },
                        { icon: Sparkles, label: "Studio" },
                        { icon: BookOpen, label: "Materi Saya" },
                        { icon: Users, label: "Kelas Saya" },
                        { icon: ClipboardList, label: "Penilaian" },
                        { icon: Settings, label: "Pengaturan" },
                      ]
                ).map((item) => (
                  <button
                    key={item.label}
                    onClick={() => handleNav(item.label)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm ${activeNav === item.label ? "bg-indigo-600 text-white" : "text-slate-400"}`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </button>
                ))}
              </nav>
              <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2.5 text-slate-400 text-sm">
                <LogOut className="w-4 h-4" /> Keluar
              </button>
            </div>
          </div>
        )}

        {/* Main */}
        <main className="flex-1 p-4 md:p-8 space-y-6 max-w-6xl mx-auto w-full min-w-0">
          {/* Mobile top bar */}
          <div className="lg:hidden flex items-center justify-between">
            <button onClick={() => setMobileNav(true)} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-indigo-400" />
              <span className="font-bold text-white">KelasKA</span>
            </div>
            <button onClick={handleLogout} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {showAuthGate && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex items-center gap-3 flex-1">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-200">Anda belum masuk</p>
                  <p className="text-xs text-amber-200/70">Silakan masuk untuk melihat data. Tanpa sesi, dashboard tidak menampilkan data (401). Pilih peran di /masuk.</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => router.push("/masuk")}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <LogIn className="w-3.5 h-3.5" /> Masuk di /masuk
                </button>
              </div>
            </div>
          )}

          {/* Header */}
          <header className="flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                {role === "siswa"
                  ? isStudentAuthed && student
                    ? `Halo, ${student.name.split(" ")[0]}! 👋`
                    : "Halo, Siswa! 👋"
                  : isGuruAuthed && user
                    ? `Halo, ${user.email?.split("@")[0]}! 👋`
                    : "Halo, Guru! 👋"}
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                {role === "siswa" ? "Ini ringkasan belajarmu hari ini. Tetap semangat!" : "Pantau kelas, nilai tugas, dan kelola pembelajaran Anda."}
              </p>
            </div>

            {/* Role switcher – only in preview */}
            {canSwitchRole ? (
              <div className="flex bg-slate-900/80 p-1 rounded-2xl border border-slate-800 w-fit">
                {(["siswa", "guru"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    aria-pressed={role === r}
                    className={`px-4 py-2 text-xs font-semibold rounded-xl capitalize transition-all ${
                      role === r ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {r === "siswa" ? "👩‍🎓 Siswa" : "👩‍🏫 Guru"}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs">
                <span className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 capitalize">
                  {role === "siswa" ? "👩‍🎓 Mode Siswa" : "👩‍🏫 Mode Guru"}
                </span>
                <button
                  onClick={fetchData}
                  disabled={dataLoading}
                  className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-50"
                  title="Muat ulang"
                >
                  <RefreshCw className={`w-4 h-4 ${dataLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            )}

            <div className="hidden md:flex items-center gap-2">
              <form onSubmit={handleSearchSubmit} className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={role === "siswa" ? "Cari kursus / tugas..." : "Cari kelas / tugas..."}
                  className="bg-slate-900/80 border border-slate-800 rounded-xl py-2 pl-9 pr-9 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-56"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1.5 p-1 rounded-lg hover:bg-slate-800 text-slate-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </form>
              <div className="relative" ref={notifRef}>
                <button
                  onClick={() => setShowNotif((v) => !v)}
                  className="relative p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-white transition-all"
                  aria-label="Notifikasi"
                >
                  <Bell className="w-4 h-4" />
                  {urgentCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-slate-950">
                      {urgentCount > 9 ? "9+" : urgentCount}
                    </span>
                  )}
                </button>
                {showNotif && (
                  <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-30 overflow-hidden">
                    <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">Notifikasi</p>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {notifItems.length} item
                      </span>
                    </div>
                    <div className="max-h-80 overflow-auto divide-y divide-slate-800/60">
                      {notifItems.length === 0 ? (
                        <p className="p-6 text-sm text-slate-500 text-center">Tidak ada notifikasi.</p>
                      ) : (
                        notifItems.map((n, i) => (
                          <div key={i} className="p-3 hover:bg-slate-800/40 transition">
                            <p className="text-sm font-medium text-white leading-snug">{n.title}</p>
                            <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {n.sub}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="p-2 border-t border-slate-800">
                      <button
                        onClick={() => {
                          setShowNotif(false);
                          const el = document.getElementById(role === "siswa" ? "tugas-section" : "todo-section");
                          el?.scrollIntoView({ behavior: "smooth" });
                        }}
                        className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
                      >
                        Lihat semua
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Mobile search */}
          <form onSubmit={handleSearchSubmit} className="md:hidden relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari..."
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl py-2.5 pl-9 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </form>

          {dataError && !dataLoading && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 flex items-center justify-between gap-3">
              <p className="text-sm text-rose-300">Gagal memuat data: {dataError}</p>
              <button onClick={fetchData} className="px-3 py-1.5 rounded-xl bg-rose-500 text-white text-xs font-semibold">
                Coba lagi
              </button>
            </div>
          )}

          {/* Stats */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {dataLoading || !statCards ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
            ) : (
              statCards.map((s) => <StatCard key={s.label} {...s} />)
            )}
          </section>

          {dataLoading ? (
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Skeleton className="h-80 rounded-2xl" />
                <Skeleton className="h-48 rounded-2xl" />
              </div>
              <Skeleton className="h-80 rounded-2xl" />
            </div>
          ) : role === "siswa" && data?.role === "siswa" ? (
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Courses */}
              <div className="lg:col-span-2 space-y-6">
                <section id="kursus-section" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-400" />
                      Kursus Saya
                      {q && <span className="text-xs font-normal text-slate-500">— {siswaCourses.length} hasil untuk “{search}”</span>}
                    </h2>
                    <button
                      onClick={() => router.push("/materi")}
                      className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
                    >
                      Lihat semua <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {siswaCourses.length === 0 ? (
                      <p className="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-800 rounded-xl">
                        Tidak ada kursus ditemukan untuk “{search}”
                      </p>
                    ) : (
                      siswaCourses.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => toast.info(c.name, { description: `Guru: ${c.teacher} · Selanjutnya: ${c.next}. Buka Workspace untuk materi lengkap.` })}
                          className="w-full text-left p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/40 transition-all group"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium text-white group-hover:text-indigo-200 transition-colors">{c.name}</p>
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
                        </button>
                      ))
                    )}
                  </div>
                </section>

                {/* Weekly activity chart */}
                <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-purple-400" />
                      Aktivitas Belajar Minggu Ini
                    </h2>
                    <span className="text-[11px] text-slate-500">menit / hari</span>
                  </div>
                  <div className="flex items-end gap-2 md:gap-3 h-36">
                    {(data as SiswaData).weeklyActivity.map((d) => (
                      <div key={d.day} className="flex-1 flex flex-col items-center gap-2 group">
                        <div className="w-full flex items-end justify-center h-28">
                          <div
                            className="w-full max-w-10 rounded-t-lg bg-gradient-to-t from-indigo-600/60 to-purple-500/80 group-hover:from-indigo-500 group-hover:to-purple-400 transition-all cursor-pointer"
                            style={{ height: `${Math.max(8, d.value)}%` }}
                            title={`${d.minutes ?? d.value} menit`}
                          />
                        </div>
                        <span className="text-[11px] text-slate-500">{d.day}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Tasks */}
              <section id="tugas-section" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 h-fit">
                <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
                  <Target className="w-4 h-4 text-amber-400" />
                  Tugas & Tenggat
                  {q && <span className="text-xs font-normal text-slate-500">— {siswaTasks.length} hasil</span>}
                </h2>
                <div className="space-y-3">
                  {siswaTasks.length === 0 ? (
                    <p className="text-sm text-slate-500 py-6 text-center border border-dashed border-slate-800 rounded-xl">Tidak ada tugas yang cocok.</p>
                  ) : (
                    siswaTasks.map((t) => (
                      <button
                        key={t.title}
                        onClick={() => toast.info(t.title, { description: `Tenggat: ${t.due}` })}
                        className="w-full text-left p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-all"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="text-sm font-medium text-white leading-snug">{t.title}</p>
                          <StatusBadge status={t.status} />
                        </div>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {t.due}
                        </p>
                      </button>
                    ))
                  )}
                </div>
                <button
                  onClick={() => toast.success("AI Tutor segera hadir!", { description: "Tanyakan materi apapun — tutor AI akan membantu menjelaskan dengan contoh interaktif." })}
                  className="mt-4 w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all inline-flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Belajar dengan AI Tutor
                </button>
                <button
                  onClick={() => router.push("/materi")}
                  className="mt-2 w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition-all"
                >
                  Buka Workspace Belajar
                </button>
              </section>
            </div>
          ) : data?.role === "guru" ? (
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Classes table + quick actions */}
              <div className="lg:col-span-2 space-y-6">
                <section id="kelas-section" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-400" />
                      Performa Kelas
                      {q && <span className="text-xs font-normal text-slate-500">— {guruClasses.length} hasil</span>}
                    </h2>
                    <button
                      onClick={() => router.push("/admin")}
                      className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
                    >
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
                        {guruClasses.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-500">
                              Tidak ada kelas ditemukan.
                            </td>
                          </tr>
                        ) : (
                          guruClasses.map((c) => {
                            const pct = Math.round((c.submitted / c.total) * 100);
                            return (
                              <tr
                                key={c.name}
                                onClick={() => router.push(`/admin`)}
                                className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30 cursor-pointer transition"
                              >
                                <td className="py-3 text-white font-medium">{c.name}</td>
                                <td className="py-3 text-slate-400">{c.students}</td>
                                <td className="py-3">
                                  <span
                                    className={`font-semibold ${
                                      c.avgScore >= 85 ? "text-emerald-400" : c.avgScore >= 78 ? "text-amber-400" : "text-rose-400"
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
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Quick actions */}
                <section className="grid sm:grid-cols-3 gap-4">
                  {[
                    { icon: Sparkles, label: "Buat Scene AI", desc: "Generate materi otomatis", accent: "from-indigo-500 to-purple-500", href: "/studio" },
                    { icon: FileText, label: "Buat Kuis", desc: "Kuis interaktif cepat", accent: "from-emerald-500 to-teal-500", href: "/admin" },
                    { icon: Video, label: "Kelas Live", desc: "Mulai sesi classroom", accent: "from-amber-500 to-orange-500", href: "/admin" },
                  ].map((a) => (
                    <button
                      key={a.label}
                      onClick={() => {
                        if (a.href) router.push(a.href);
                        else toast.info(a.label);
                      }}
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
                <section id="todo-section" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-amber-400" />
                      Perlu Dikerjakan
                    </h2>
                    {q && <span className="text-[11px] text-slate-500">{guruTodos.length} hasil</span>}
                  </div>
                  <div className="space-y-3">
                    {guruTodos.length === 0 ? (
                      <p className="text-sm text-slate-500 py-6 text-center border border-dashed border-slate-800 rounded-xl">Tidak ada tugas yang cocok.</p>
                    ) : (
                      guruTodos.map((t) => (
                        <button
                          key={t.title}
                          onClick={() => router.push("/admin")}
                          className="w-full text-left p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-all"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <p className="text-sm font-medium text-white leading-snug">{t.title}</p>
                            <StatusBadge status={t.status} />
                          </div>
                          <p className="text-[11px] text-slate-500">{t.detail}</p>
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
                  <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
                    <Star className="w-4 h-4 text-yellow-400" />
                    Siswa Terbaik Minggu Ini
                  </h2>
                  <div className="space-y-2.5">
                    {(data as GuruData).topStudents.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => router.push("/admin")}
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-800/50 transition text-left"
                      >
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 ${
                            i === 0
                              ? "bg-yellow-500/20 text-yellow-400"
                              : i === 1
                                ? "bg-slate-400/20 text-slate-300"
                                : "bg-slate-800 text-slate-500"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <img
                          src={s.avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${s.name}`}
                          alt={s.name}
                          className="w-7 h-7 rounded-full bg-slate-700 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{s.name}</p>
                          <p className="text-[11px] text-slate-500">{s.class}</p>
                        </div>
                        <span className="text-sm font-semibold text-emerald-400">{s.score}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          ) : null}

          {/* Settings modal */}
          {showSettings && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
              <div className="relative bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Settings className="w-4 h-4 text-slate-400" /> Pengaturan
                  </h3>
                  <button onClick={() => setShowSettings(false)} className="p-2 rounded-xl bg-slate-800 text-slate-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      setShowSettings(false);
                      toast.info("Tema gelap sudah aktif. Tema terang segera hadir.");
                    }}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-indigo-500/40 transition text-left"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">Tema</p>
                      <p className="text-xs text-slate-500">Gelap (default KelasKA)</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  </button>
                  {isStudentAuthed && (
                    <button
                      onClick={() => {
                        setShowSettings(false);
                        setChangePwdOpen(true);
                      }}
                      className="w-full flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-indigo-500/40 transition text-left"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">Ganti Kata Sandi</p>
                        <p className="text-xs text-slate-500">Perbarui kata sandi akun siswa</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowSettings(false);
                      fetchData();
                      toast.success("Data diperbarui");
                    }}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-indigo-500/40 transition text-left"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">Muat Ulang Data</p>
                      <p className="text-xs text-slate-500">Segarkan statistik dashboard</p>
                    </div>
                    <RefreshCw className="w-4 h-4 text-slate-500" />
                  </button>
                  <button
                    onClick={() => {
                      setShowSettings(false);
                      router.push("/");
                    }}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-indigo-500/40 transition text-left"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">Kembali ke Landing</p>
                      <p className="text-xs text-slate-500">Halaman utama KelasKA</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Change password modal */}
          {changePwdOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChangePwdOpen(false)} />
              <form
                onSubmit={handleChangePassword}
                className="relative bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">Ganti Kata Sandi</h3>
                  <button type="button" onClick={() => setChangePwdOpen(false)} className="p-2 rounded-xl bg-slate-800 text-slate-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Kata Sandi Lama</label>
                  <input
                    type="password"
                    required
                    value={oldPwd}
                    onChange={(e) => setOldPwd(e.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Kata Sandi Baru (min 6)</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={() => setChangePwdOpen(false)} className="px-4 py-2 text-sm text-slate-400">
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={changing}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {changing && <Loader2 className="w-4 h-4 animate-spin" />} Simpan
                  </button>
                </div>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
