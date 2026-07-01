'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  Award,
  CheckCircle2,
  Calendar,
  Building,
  User,
  GraduationCap,
  Loader2,
  AlertCircle,
  FileBadge,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type VerificationData = {
  verificationCode: string;
  issuedAt: string;
  studentName: string;
  courseTitle: string;
  organizationName: string;
};

export default function CertificateVerificationPage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  const [data, setData] = useState<VerificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (code) {
      verifyCertificate();
    }
  }, [code]);

  const verifyCertificate = async () => {
    try {
      const res = await fetch(`/api/certificates/verify/${code}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json.certificate);
      } else {
        setError(json.error || 'Sertifikat tidak valid');
      }
    } catch (err) {
      console.error(err);
      setError('Kesalahan koneksi internet');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col justify-center items-center p-6">
      {/* Brand logo */}
      <div className="flex items-center gap-2 mb-8 cursor-pointer" onClick={() => router.push('/')}>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-md">
          <GraduationCap className="h-5 w-5" />
        </div>
        <span className="font-bold text-lg text-zinc-900 dark:text-white tracking-tight">
          KelasKA
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg"
      >
        {error ? (
          /* Error Card */
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 text-center space-y-4 shadow-xl">
            <div className="mx-auto w-16 h-16 bg-rose-50 dark:bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-500">
              <AlertCircle className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Verifikasi Gagal</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{error}</p>
            </div>
            <Button
              onClick={() => router.push('/')}
              className="bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl px-6"
            >
              Kembali ke Beranda
            </Button>
          </div>
        ) : (
          /* Verification Success Card */
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 shadow-xl relative overflow-hidden space-y-6">
            {/* Watermark badge icon */}
            <div className="absolute -right-16 -bottom-16 opacity-5 dark:opacity-10 text-indigo-500 pointer-events-none">
              <Award style={{ width: 240, height: 240 }} />
            </div>

            {/* Header Badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-3.5 py-1.5 rounded-full text-xs font-bold">
                <CheckCircle2 className="h-4 w-4" />
                Sertifikat Terverifikasi
              </div>
              <FileBadge className="h-7 w-7 text-indigo-500" />
            </div>

            {/* Certificate Details */}
            <div className="space-y-4 pt-2">
              <div className="space-y-1 text-center sm:text-left">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                  Diberikan Kepada
                </span>
                <h3 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center justify-center sm:justify-start gap-2">
                  <User className="h-5 w-5 text-indigo-500 flex-shrink-0" />
                  {data?.studentName}
                </h3>
              </div>

              <div className="space-y-1 text-center sm:text-left">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                  Atas Kelulusan Kursus
                </span>
                <h4 className="text-lg font-bold text-zinc-900 dark:text-white leading-snug">
                  {data?.courseTitle}
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <div className="space-y-0.5">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest block">
                    Penerbit
                  </span>
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <Building className="h-3.5 w-3.5 text-zinc-400" />
                    {data?.organizationName}
                  </span>
                </div>

                <div className="space-y-0.5">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest block">
                    Tanggal Terbit
                  </span>
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                    {data ? new Date(data.issuedAt).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    }) : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Verification Code */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3 border border-zinc-100 dark:border-zinc-800 text-center space-y-1">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">
                Kode Kredensial
              </span>
              <code className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 break-all select-all">
                {data?.verificationCode}
              </code>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
