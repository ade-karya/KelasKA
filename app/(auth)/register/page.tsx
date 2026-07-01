'use client';

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function RegisterPage() {
  const router = useRouter();
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) {
      toast.error('Silakan isi semua bidang');
      return;
    }

    if (password.length < 6) {
      toast.error('Kata sandi minimal harus 6 karakter');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || 'Gagal mendaftarkan akun');
      } else {
        toast.success('Pendaftaran berhasil! Silakan masuk.');
        
        // Auto sign in after registration
        const res = await signIn('credentials', {
          email,
          password,
          redirect: false,
          callbackUrl: '/dashboard',
        });

        if (res?.error) {
          router.push('/login');
        } else {
          router.push('/dashboard');
          router.refresh();
        }
      }
    } catch (err) {
      toast.error('Terjadi kesalahan saat mendaftar');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      await signIn('google', { callbackUrl: '/dashboard' });
    } catch (err) {
      toast.error('Gagal masuk dengan Google');
      setGoogleLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="text-center lg:text-left">
        <div className="flex justify-center lg:justify-start lg:hidden mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-lg">
            <GraduationCap className="h-6 w-6" />
          </div>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Mulai Belajar Sekarang
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Sudah punya akun?{' '}
          <a href="/login" className="font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
            Masuk di sini
          </a>
        </p>
      </div>

      {/* Google Login */}
      <Button
        variant="outline"
        type="button"
        className="w-full flex items-center justify-center gap-3 py-6 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        onClick={handleGoogleLogin}
        disabled={googleLoading || loading}
      >
        {googleLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 24 24" width="24" height="24">
            <g transform="matrix(1, 0, 0, 1, 0, 0)">
              <path
                d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.05,3.1l3.2,2.5c1.88,-1.73 2.97,-4.29 2.97,-7.22C21.5,11.75 21.45,11.4 21.35,11.1z"
                fill="#4285F4"
              />
              <path
                d="M12,20.5c2.3,0 4.22,-0.76 5.63,-2.08l-3.2,-2.5c-0.89,0.6 -2.03,0.96 -3.43,0.96 -2.64,0 -4.88,-1.78 -5.68,-4.17L2.03,15.3C3.5,18.2 6.51,20.5 12,20.5z"
                fill="#34A853"
              />
              <path
                d="M6.32,12.71c-0.21,-0.64 -0.32,-1.32 -0.32,-2.02s0.11,-1.38 0.32,-2.02L2.03,6.08C1.2,7.74 0.75,9.6 0.75,11.5s0.45,3.76 1.28,5.42L6.32,12.71z"
                fill="#FBBC05"
              />
              <path
                d="M12,5.15c1.25,0 2.37,0.43 3.25,1.27l2.43,-2.43C16.21,2.6 14.29,1.75 12,1.75 6.51,1.75 3.5,4.06 2.03,6.96l4.29,3.33C7.12,6.93 9.36,5.15 12,5.15z"
                fill="#EA4335"
              />
            </g>
          </svg>
        )}
        <span>Daftar dengan Google</span>
      </Button>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-zinc-50 dark:bg-zinc-950 px-2 text-zinc-500">
            atau daftar dengan email
          </span>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nama Lengkap</Label>
          <Input
            id="name"
            type="text"
            placeholder="Budi Santoso"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading || googleLoading}
            className="py-6"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Alamat Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="nama@contoh.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading || googleLoading}
            className="py-6"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Kata Sandi</Label>
          <Input
            id="password"
            type="password"
            placeholder="Minimal 6 karakter"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading || googleLoading}
            className="py-6"
          />
        </div>

        <Button
          type="submit"
          className="w-full py-6 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30"
          disabled={loading || googleLoading}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Mendaftarkan...
            </span>
          ) : (
            'Buat Akun Baru'
          )}
        </Button>
      </form>
    </motion.div>
  );
}
