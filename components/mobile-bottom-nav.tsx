'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BookOpen,
  Bell,
  User,
  GraduationCap,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Dasbor', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'Kursus', icon: BookOpen, href: '/courses' },
  { label: 'Kelas AI', icon: GraduationCap, href: '/' },
  { label: 'Notifikasi', icon: Bell, href: '/notifications' },
  { label: 'Profil', icon: User, href: '/profile' },
];

export function MobileBottomNav() {
  const router = useRouter();
  const pathname = usePathname();

  // Only show on small screens (md: hidden via CSS)
  return (
    <nav
      className="
        fixed bottom-0 left-0 right-0 z-50 
        bg-white dark:bg-zinc-900 
        border-t border-zinc-200 dark:border-zinc-800 
        grid grid-cols-5 
        pb-safe
        md:hidden
        shadow-[0_-4px_20px_rgba(0,0,0,0.08)]
      "
      aria-label="Navigasi bawah"
    >
      {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
        const isActive = href === '/'
          ? pathname === '/'
          : pathname.startsWith(href);

        return (
          <button
            key={href}
            onClick={() => router.push(href)}
            className={`
              flex flex-col items-center justify-center gap-0.5 
              py-3 px-1 
              text-[10px] font-semibold 
              transition-all
              ${isActive
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }
            `}
            aria-label={label}
          >
            <Icon
              className={`h-5 w-5 transition-transform ${isActive ? 'scale-110' : ''}`}
              strokeWidth={isActive ? 2.5 : 1.8}
            />
            <span className={isActive ? 'text-indigo-600 dark:text-indigo-400' : ''}>
              {label}
            </span>
            {isActive && (
              <span className="absolute bottom-0 w-6 h-0.5 bg-indigo-500 rounded-t-full" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
