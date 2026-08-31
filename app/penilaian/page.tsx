'use client';
import { useRouter } from 'next/navigation';
import { ClipboardList, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PenilaianPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <button onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-6"><ArrowLeft className="w-4 h-4" /> Kembali ke Dashboard</button>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 grid place-items-center"><ClipboardList className="w-5 h-5 text-white" /></div>
          <h1 className="text-xl font-bold">Penilaian</h1>
        </div>
        <p className="text-sm text-slate-400 mb-6">Nilai & kuis kelas ampu. Data dari quiz_attempts tenant-scoped.</p>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center">
          <ClipboardList className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm font-medium text-white">Belum ada penilaian untuk ditampilkan</p>
          <p className="text-xs text-slate-500 mt-1">Setelah siswa submit kuis di /classroom/[id], skor muncul di sini dan di Dashboard.</p>
          <Button onClick={() => router.push('/admin')} className="mt-4 rounded-full">Kelola Tugas di Admin</Button>
        </div>
      </div>
    </div>
  );
}
