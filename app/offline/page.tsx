'use client';

import { WifiOff, RefreshCw, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-white">
      {/* Brand */}
      <div className="flex items-center gap-2 mb-12">
        <div className="h-10 w-10 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <GraduationCap className="h-6 w-6 text-white" />
        </div>
        <span className="text-xl font-bold tracking-tight">KelasKA</span>
      </div>

      {/* Icon */}
      <div className="w-24 h-24 bg-zinc-800 rounded-3xl flex items-center justify-center mb-6 shadow-2xl">
        <WifiOff className="h-12 w-12 text-zinc-400" />
      </div>

      {/* Text */}
      <h1 className="text-2xl font-bold text-center mb-3">Tidak Ada Koneksi</h1>
      <p className="text-zinc-400 text-center text-sm max-w-xs leading-relaxed mb-8">
        Anda sedang offline. Beberapa materi yang sudah di-cache mungkin masih bisa diakses. 
        Silakan periksa koneksi internet Anda dan coba lagi.
      </p>

      {/* Retry */}
      <Button
        onClick={() => window.location.reload()}
        className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-2.5 rounded-xl shadow-lg shadow-indigo-500/25"
      >
        <RefreshCw className="h-4 w-4 mr-2" />
        Coba Lagi
      </Button>
    </div>
  );
}
