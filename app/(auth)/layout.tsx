'use client';

import React from 'react';
import { motion } from 'motion/react';
import { GraduationCap } from 'lucide-react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans text-zinc-900 dark:text-zinc-50">
      {/* Left side: Premium branding & illustration */}
      <div className="relative hidden w-0 flex-1 lg:flex lg:flex-col lg:justify-between bg-zinc-900 p-12 overflow-hidden">
        {/* Background gradient/glows */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/20 via-purple-500/10 to-transparent pointer-events-none" />
        <div className="absolute -bottom-48 -left-48 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/25">
            <GraduationCap className="h-6 w-6" />
          </div>
          <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
            KelasKA
          </span>
        </div>

        <div className="relative z-10 my-auto max-w-md">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl"
          >
            Masa Depan Pembelajaran Interaktif.
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mt-6 text-lg text-zinc-400 leading-relaxed"
          >
            LMS cerdas dengan guru AI dan teman sekelas AI yang interaktif. Belajar lebih cepat, lebih paham, dan lebih menyenangkan.
          </motion.p>
        </div>

        <div className="relative z-10 flex items-center justify-between text-sm text-zinc-500">
          <p>© 2026 KelasKA Team. All rights reserved.</p>
          <div className="flex gap-4">
            <a href="#" className="hover:text-zinc-300 transition-colors">Syarat & Ketentuan</a>
            <a href="#" className="hover:text-zinc-300 transition-colors">Kebijakan Privasi</a>
          </div>
        </div>
      </div>

      {/* Right side: Auth forms */}
      <div className="flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          {children}
        </div>
      </div>
    </div>
  );
}
