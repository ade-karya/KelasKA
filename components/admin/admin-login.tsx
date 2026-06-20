'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, ArrowRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function AdminLogin() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorShake, setErrorShake] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        toast.success('Login successful');
        // Let the layout re-check the auth state and render children
        router.refresh(); 
      } else {
        triggerError();
        toast.error('Invalid password');
      }
    } catch {
      triggerError();
      toast.error('Login failed');
    } finally {
      setLoading(false);
    }
  };

  const triggerError = () => {
    setErrorShake(true);
    setTimeout(() => setErrorShake(false), 500);
    setPassword('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-[120px]" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn('w-full max-w-md relative z-10', errorShake && 'animate-shake')}
      >
        <Card className="p-8 backdrop-blur-xl bg-white/5 border-white/10 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="h-16 w-16 bg-gradient-to-tr from-violet-600 to-blue-500 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-violet-500/20">
              <Lock className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Admin Dashboard</h1>
            <p className="text-slate-400 mt-2 text-sm text-center">
              Enter the admin password to manage users and provider configurations.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-4 pr-12 py-6 bg-black/20 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-violet-500/50 rounded-xl"
                disabled={loading}
              />
              <AnimatePresence>
                {password && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    <Button
                      type="submit"
                      size="icon"
                      className="h-8 w-8 rounded-lg bg-violet-600 hover:bg-violet-700 text-white"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
