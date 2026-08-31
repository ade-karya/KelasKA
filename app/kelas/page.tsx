'use client';
import { useRouter } from 'next/navigation';
import { Users, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function KelasPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <button onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-6"><ArrowLeft className="w-4 h-4" /> Kembali ke Dashboard</button>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 grid place-items-center"><Users className="w-5 h-5 text-white" /></div>
          <h1 className="text-xl font-bold">Kelas Saya</h1>
        </div>
        <p className="text-sm text-slate-400 mb-6">Ringkasan kelas ampu Anda (sesuai profiles.class_names). Kelola siswa & tugas di sini.</p>
        <div className="grid md:grid-cols-3 gap-4">
          {['KA-101','KA-102','KA-103'].map(k => (
            <div key={k} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-xs font-semibold tracking-widest text-slate-500">{k}</div>
              <div className="mt-2 text-sm font-medium text-white">Kelas {k}</div>
              <div className="text-xs text-slate-500">Menampilkan performa nyata per kelas di dashboard guru.</div>
              <Button variant="outline" size="sm" className="mt-4 rounded-full w-full" onClick={() => router.push('/admin')}>Kelola di Admin</Button>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm font-medium text-white">Ingin melihat siswa & penilaian?</p>
          <p className="text-xs text-slate-500 mt-1">Guru melihat hanya kelas ampu. Admin melihat semua kelas tenant.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" className="rounded-full" onClick={() => router.push('/penilaian')}>Ke Penilaian</Button>
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => router.push('/dashboard')}>Dashboard Guru</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
