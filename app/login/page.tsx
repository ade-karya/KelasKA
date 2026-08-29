"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabaseAuth } from "@/lib/contexts/supabase-auth-context";
import { logUserActivity } from "@/lib/supabase/activity-logger";
import { Lock, Mail, UserCheck, LogIn, ArrowRight, ShieldCheck, Activity, GraduationCap } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { user, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut, loading } = useSupabaseAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    if (mode === "signin") {
      const { error } = await signInWithEmail(email, password);
      if (error) {
        setErrorMsg(error.message || "Gagal masuk. Periksa email & kata sandi.");
      } else {
        setSuccessMsg("Berhasil masuk! Mengalihkan...");
        setTimeout(() => {
          router.push("/admin");
        }, 1200);
      }
    } else {
      const { error } = await signUpWithEmail(email, password);
      if (error) {
        setErrorMsg(error.message || "Gagal mendaftar.");
      } else {
        setSuccessMsg("Pendaftaran berhasil! Silakan periksa konfirmasi email atau masuk.");
      }
    }
    setIsSubmitting(false);
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setIsSubmitting(true);
    await logUserActivity({
      action: "OAUTH_GOOGLE_CLICKED",
      details: { page: "/login" },
    });
    const { error } = await signInWithGoogle();
    if (error) {
      setErrorMsg(error.message || "Gagal masuk via Google");
    }
    setIsSubmitting(false);
  };

  const handleSignOut = async () => {
    await signOut();
    setSuccessMsg("Telah keluar.");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Animated Accents */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/30 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-600/30 rounded-full blur-3xl pointer-events-none animate-pulse" />

      <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative z-10 transition-all">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/25 mb-4">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            Supabase Auth & Activity Tracker
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            Masuk untuk mengakses dasbor & mencatat aktivitas pengguna secara real-time.
          </p>
        </div>

        {/* If user is already logged in */}
        {user ? (
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-5 text-center space-y-4">
            <div className="inline-flex p-3 rounded-full bg-emerald-500/10 text-emerald-400 mb-1">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Terautentikasi sebagai:</p>
              <p className="text-base font-medium text-white truncate mt-0.5">{user.email}</p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => router.push("/admin/activity-logs")}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-medium text-white shadow-lg shadow-indigo-600/30 transition-all text-sm"
              >
                <Activity className="w-4 h-4" />
                Lihat Log Aktivitas
              </button>
              <button
                onClick={handleSignOut}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium border border-slate-700 transition-all text-sm"
              >
                Keluar (Sign Out)
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Mode Switcher Tabs */}
            <div className="flex bg-slate-950/60 p-1 rounded-2xl border border-slate-800/80 mb-6">
              <button
                type="button"
                onClick={() => { setMode("signin"); setErrorMsg(null); setSuccessMsg(null); }}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                  mode === "signin"
                    ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Masuk
              </button>
              <button
                type="button"
                onClick={() => { setMode("signup"); setErrorMsg(null); setSuccessMsg(null); }}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                  mode === "signup"
                    ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Daftar Akun
              </button>
            </div>

            {/* Error & Success Messages */}
            {errorMsg && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-medium animate-fadeIn">
                {errorMsg}
              </div>
            )}
            {successMsg && (
              <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium animate-fadeIn">
                {successMsg}
              </div>
            )}

            {/* Auth Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Alamat Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@email.com"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Kata Sandi</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || loading}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    {mode === "signin" ? "Masuk ke Akun" : "Buat Akun Baru"}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="my-6 flex items-center gap-3">
              <div className="h-px bg-slate-800 flex-1" />
              <span className="text-[11px] text-slate-500 font-medium uppercase">Atau</span>
              <div className="h-px bg-slate-800 flex-1" />
            </div>

            {/* Social OAuth */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/50 text-slate-200 font-medium text-xs transition-all"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#EA4335"
                  d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z"
                />
              </svg>
              Lanjutkan dengan Google
            </button>
          </>
        )}

        {/* Footer Link */}
        <div className="mt-8 pt-4 border-t border-slate-800/80 text-center space-y-2">
          <button
            onClick={() => router.push("/admin/activity-logs")}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1 transition-colors"
          >
            <Activity className="w-3.5 h-3.5" />
            Buka Halaman Monitoring Activity Log
          </button>
          <div>
            <button
              onClick={() => router.push("/login-siswa")}
              className="text-xs text-slate-400 hover:text-slate-200 font-medium inline-flex items-center gap-1 transition-colors"
            >
              <GraduationCap className="w-3.5 h-3.5" />
              Login Siswa dengan NISN
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
