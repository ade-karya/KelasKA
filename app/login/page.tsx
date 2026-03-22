'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { useAuthStore } from '@/lib/store/auth';
import { Button } from '@/components/ui/button';
import { ArrowRight, UserSquare2, Lock, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [nisn, setNisn] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const router = useRouter();

  // Wait for hydration to grab isAuth store data accurately to prevent flash
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (isClient && isLoggedIn) {
      router.replace('/');
    }
  }, [isClient, isLoggedIn, router]);

  if (!isClient) return null; // Avoid Hydration Mismatch

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const success = await login(nisn, pin);
      if (success) {
        router.push('/');
      } else {
        setError('NISN harus 10 digit angka dan PIN harus 6 digit angka.');
      }
    } catch (err) {
      setError('Terjadi kesalahan saat masuk.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 overflow-hidden relative">
      {/* Background Decor */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div
          className="absolute top-0 left-1/4 w-[40rem] h-[40rem] bg-blue-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '4s' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-[40rem] h-[40rem] bg-purple-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '6s' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-3xl border border-border/40 shadow-2xl overflow-hidden p-[1px]">
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-3xl rounded-[calc(1.5rem-1px)] p-8 h-full">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-violet-600 to-indigo-600 dark:from-violet-400 dark:to-indigo-400 bg-clip-text text-transparent mb-2">
                Masuk Siswa
              </h1>
              <p className="text-[14px] text-muted-foreground">
                Gunakan NISN dan PIN untuk mengakses kelas Anda
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground ml-1">
                  NISN
                </label>
                <div className="relative group">
                  <div className="absolute left-3.5 top-1/2 -mt-[9px] text-muted-foreground/60 group-focus-within:text-violet-500 transition-colors">
                    <UserSquare2 className="size-[18px]" />
                  </div>
                  <input
                    type="text"
                    required
                    value={nisn}
                    onChange={(e) => setNisn(e.target.value.replace(/\D/g, ''))}
                    placeholder="Masukkan 10 digit angka"
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-950 border border-border/60 hover:border-violet-500/40 rounded-xl text-[14px] font-medium focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-500 transition-all placeholder:font-normal"
                    maxLength={10}
                    inputMode="numeric"
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground/40 bg-muted px-1.5 py-0.5 rounded">
                    {nisn.length}/10
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground ml-1">
                  PIN
                </label>
                <div className="relative group">
                  <div className="absolute left-3.5 top-1/2 -mt-[9px] text-muted-foreground/60 group-focus-within:text-violet-500 transition-colors">
                    <Lock className="size-[18px]" />
                  </div>
                  <input
                    type="password"
                    required
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="6 digit PIN rahasia"
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-950 border border-border/60 hover:border-violet-500/40 rounded-xl text-[14px] font-medium tracking-widest focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-500 transition-all placeholder:tracking-normal placeholder:font-normal"
                    maxLength={6}
                    inputMode="numeric"
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground/40 bg-muted px-1.5 py-0.5 rounded tracking-normal">
                    {pin.length}/6
                  </div>
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: -5 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  className="py-1"
                >
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-600 dark:text-red-400 font-medium">
                    {error}
                  </div>
                </motion.div>
              )}

              <Button
                type="submit"
                disabled={isLoading || nisn.length < 10 || pin.length < 6}
                className="w-full mt-2 rounded-xl bg-violet-600 hover:bg-violet-700 active:scale-[0.98] text-white shadow-[0_0_20px_rgba(124,58,237,0.2)] hover:shadow-[0_0_25px_rgba(124,58,237,0.4)] transition-all h-[46px] relative group overflow-hidden"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-in-out" />
                {isLoading ? (
                  <Loader2 className="size-[18px] animate-spin relative z-10" />
                ) : (
                  <div className="flex items-center justify-center gap-2 relative z-10">
                    <span className="font-semibold text-[15px]">Masuk ke Kelas</span>
                    <ArrowRight className="size-[18px] group-hover:translate-x-1 transition-transform" />
                  </div>
                )}
              </Button>
            </form>
          </div>
        </div>
      </motion.div>
      <div className="mt-12 text-xs text-muted-foreground/50 tracking-wide">
        KELAS KECERDASAN ARTIFISIAL
      </div>
    </div>
  );
}
