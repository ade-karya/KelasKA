"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useStudentAuth } from "@/lib/contexts/student-auth-context";
import { GraduationCap, Hash, Lock, LogIn, ArrowRight, UserCheck, ShieldCheck } from "lucide-react";

export default function StudentLoginPage() {
  const router = useRouter();
  const { student, login, logout, loading } = useStudentAuth();

  const [nisn, setNisn] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    const { error } = await login(nisn, password);
    if (error) {
      setErrorMsg(error.message || "Gagal masuk. Periksa NISN & kata sandi.");
      setIsSubmitting(false);
    } else {
      setTimeout(() => {
        router.push("/dashboard");
      }, 800);
    }
  };

  const handleLogout = async () => {
    logout();
    setNisn("");
    setPassword("");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Animated Accents */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/30 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-600/30 rounded-full blur-3xl pointer-events-none animate-pulse" />

      <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative z-10 transition-all">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-500 to-purple-500 text-white shadow-lg shadow-purple-500/25 mb-4">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            Login Siswa KelasKA
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            Masuk menggunakan NISN untuk mengakses dasbor pembelajaranmu.
          </p>
        </div>

        {/* If student is already logged in */}
        {student ? (
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-5 text-center space-y-4">
            <div className="inline-flex p-3 rounded-full bg-emerald-500/10 text-emerald-400 mb-1">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Terautentikasi sebagai:</p>
              <p className="text-base font-medium text-white truncate mt-0.5">{student.name}</p>
              <p className="text-xs text-slate-500 mt-1">
                {student.nisn} · {student.class_name ?? "Tanpa kelas"}
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => router.push("/dashboard")}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 font-medium text-white shadow-lg shadow-purple-600/30 transition-all text-sm"
              >
                <LogIn className="w-4 h-4" />
                Buka Dashboard
              </button>
              <button
                onClick={handleLogout}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium border border-slate-700 transition-all text-sm"
              >
                Keluar (Sign Out)
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Error Message */}
            {errorMsg && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-medium animate-fadeIn">
                {errorMsg}
              </div>
            )}

            {/* Student Login Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">NISN</label>
                <div className="relative">
                  <Hash className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    required
                    value={nisn}
                    onChange={(e) => setNisn(e.target.value)}
                    placeholder="Masukkan NISN"
                    autoComplete="username"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all"
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
                    autoComplete="current-password"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || loading}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold text-sm shadow-lg shadow-purple-600/30 transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    Masuk sebagai Siswa
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </>
        )}

        {/* Footer Link */}
        <div className="mt-8 pt-4 border-t border-slate-800/80 text-center">
          <button
            onClick={() => router.push("/login")}
            className="text-xs text-purple-400 hover:text-purple-300 font-medium inline-flex items-center gap-1 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Login Admin / Staf dengan email
          </button>
        </div>

      </div>
    </div>
  );
}