'use client';
import { useRouter } from 'next/navigation';
import { BookOpen, Sparkles, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MateriPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <button onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-6"><ArrowLeft className="w-4 h-4" /> Kembali ke Dashboard</button>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-violet-600 grid place-items-center"><BookOpen className="w-5 h-5 text-white" /></div>
          <h1 className="text-xl font-bold">Materi Saya</h1>
          <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-400">Draft • In Review • Published</span>
        </div>
        <p className="text-sm text-slate-400 mb-6">Daftar kelas yang Anda buat. Review sebelum publish, lalu assign ke kelas.</p>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center">
          <BookOpen className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm font-medium text-white">Belum ada materi</p>
          <p className="text-xs text-slate-500 mt-1">Materi dari Studio akan muncul di sini setelah generate. Status awal: draft.</p>
          <Button onClick={() => router.push('/studio')} className="mt-4 rounded-full bg-violet-600 hover:bg-violet-500"><Sparkles className="w-4 h-4" /> Buka Studio</Button>
        </div>
        <p className="text-[11px] text-slate-500 mt-4">Siklus: draft → in_review → published → assign. Siswa hanya melihat published yang di-assign ke class_name-nya.</p>
      </div>
    </div>
  );
}
