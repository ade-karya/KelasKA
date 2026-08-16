'use client';

import { useRouter } from 'next/navigation';
import { LogIn, LogOut, UserRound } from 'lucide-react';
import { useStudentAuth } from '@/lib/contexts/student-auth-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Student auth control for the stage chrome pill cluster. Shows a "Masuk"
 * button when signed out, or a profile dropdown (name, Profil, Keluar) when
 * signed in. Uses a Radix DropdownMenu so the menu portals to body and is
 * never clipped by the stage layout.
 */
export function StudentAuthButton() {
  const router = useRouter();
  const { student, loading, logout } = useStudentAuth();

  if (loading) {
    return (
      <button
        className="p-2 rounded-full text-gray-300 dark:text-gray-600 cursor-default"
        aria-label="Loading"
      >
        <UserRound className="w-4 h-4 opacity-50" />
      </button>
    );
  }

  if (!student) {
    return (
      <button
        onClick={() => router.push('/login-siswa')}
        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 shadow-sm hover:shadow-md transition-all active:scale-[0.97]"
        aria-label="Masuk siswa"
      >
        <LogIn className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Masuk</span>
      </button>
    );
  }

  const initial = student.name?.trim()?.charAt(0)?.toUpperCase() ?? 'S';

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white bg-gradient-to-tr from-violet-500 to-purple-500 shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all"
          aria-label={student.name}
          title={student.name}
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[180px]">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{student.name}</span>
          <span className="text-[11px] font-normal text-muted-foreground">
            {student.nisn} · {student.class_name ?? 'Tanpa kelas'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer gap-2" onSelect={() => router.push('/profile')}>
          <UserRound className="w-4 h-4" />
          Profil
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onSelect={() => {
            logout();
            router.refresh();
          }}
        >
          <LogOut className="w-4 h-4" />
          Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}