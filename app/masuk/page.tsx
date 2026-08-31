'use client';

import { useRouter } from 'next/navigation';
import { GraduationCap, ShieldCheck, ArrowRight, Users, BookOpen } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';

export default function MasukPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex flex-col">
      {/* header minimal */}
      <header className="w-full border-b border-slate-200/60 dark:border-slate-800/60 bg-white/70 dark:bg-slate-950/60 backdrop-blur-xl">
        <div className="mx-auto max-w-[1080px] px-4 md:px-6 h-[64px] flex items-center justify-between">
          <button onClick={() => router.push('/')} className="flex items-center gap-2.5">
            <BrandLogo size="sm" />
          </button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => router.push('/')}>Kembali ke Beranda</Button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[900px]">
          <div className="text-center mb-8">
            <h1 className="text-[28px] md:text-[36px] font-black tracking-tight text-slate-900 dark:text-white">Masuk ke KelasKA</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Pilih peran Anda untuk melanjutkan. Satu pintu masuk, beranda sesuai peran.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {/* Siswa */}
            <div className="rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 md:p-8 flex flex-col shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 grid place-items-center text-white shadow-lg shadow-violet-500/20">
                <GraduationCap className="w-6 h-6" />
              </div>
              <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">Siswa</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">Masuk dengan NISN dan kata sandi untuk melihat Kursus Saya, tugas, dan nilai.</p>
              <ul className="mt-4 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <li className="inline-flex gap-2"><BookOpen className="w-3.5 h-3.5 mt-0.5 text-violet-500" /> Hanya materi yang di-assign kelas Anda</li>
                <li className="inline-flex gap-2"><Users className="w-3.5 h-3.5 mt-0.5 text-violet-500" /> Kuis & nilai pribadi</li>
              </ul>
              <Button onClick={() => router.push('/login-siswa')} className="mt-6 w-full rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 font-semibold">
                Masuk sebagai Siswa
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
              <p className="mt-2 text-center text-[11px] text-slate-500">NISN + kata sandi • Aman per sekolah</p>
            </div>

            {/* Guru */}
            <div className="rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 md:p-8 flex flex-col shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 grid place-items-center text-white shadow-lg shadow-indigo-500/20">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">Guru & Operator</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">Masuk dengan email atau Google untuk mengajar, membuat kelas, dan mengelola sekolah Anda.</p>
              <ul className="mt-4 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <li className="inline-flex gap-2"><BookOpen className="w-3.5 h-3.5 mt-0.5 text-indigo-500" /> Studio generate di dalam app</li>
                <li className="inline-flex gap-2"><Users className="w-3.5 h-3.5 mt-0.5 text-indigo-500" /> Kelola siswa & tugas per kelas ampu</li>
              </ul>
              <Button onClick={() => router.push('/login')} className="mt-6 w-full rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold shadow-md shadow-violet-500/20">
                Masuk sebagai Guru
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
              <p className="mt-2 text-center text-[11px] text-slate-500">Email + Google • Role teacher/admin</p>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">Sudah masuk? Anda akan otomatis diarahkan ke <span className="font-semibold text-slate-700 dark:text-slate-300">/dashboard</span> sesuai peran.</p>
        </div>
      </main>

      <footer className="py-6 text-center text-[11px] text-slate-400">© 2026 KelasKA • Satu prompt, satu kelas utuh. Review, publish, assign ke KA-101–103.</footer>
    </div>
  );
}
