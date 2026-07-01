'use client';

import React, { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Bell,
  GraduationCap,
  LogOut,
  ChevronDown,
  User,
  BookOpen,
  LayoutDashboard,
  CheckCircle2,
  AlertCircle,
  FolderLock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type Notification = {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  type: string;
  link: string | null;
  createdAt: string;
};

type Tenant = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
};

export function DashboardHeader() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    if (session?.user) {
      fetchNotifications();
      fetchTenants();
    }
  }, [session]);

  // Close menus on click outside
  useEffect(() => {
    const handleOutsideClick = () => {
      setShowNotifications(false);
      setShowUserMenu(false);
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTenants = async () => {
    try {
      // In a real multi-tenant scenario, we retrieve the tenants from local session details
      // or fetch `/api/tenants`
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setTenants(data.tenants || []);
        if (data.tenants?.length > 0) {
          setCurrentTenant(data.tenants[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch('/api/notifications', { method: 'PUT' });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
        toast.success('Semua notifikasi ditandai dibaca');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const isInstructor = tenants.some(
    (t) => t.role === 'INSTRUCTOR' || t.role === 'ADMIN' || t.role === 'SUPER_ADMIN'
  );

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-40 shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Tenant Selector */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => router.push('/dashboard')}>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-md">
              <GraduationCap className="h-5 w-5" />
            </div>
            <span className="font-bold text-lg text-zinc-900 dark:text-white tracking-tight hidden sm:inline-block">
              KelasKA
            </span>
          </div>

          {/* Tenant Switcher dropdown */}
          {currentTenant && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toast.info('Pindah kelas/tenant akan segera hadir!');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition-colors"
              >
                <span>{currentTenant.tenantName}</span>
                <ChevronDown className="h-3 w-3 text-zinc-400" />
              </button>
            </div>
          )}
        </div>

        {/* Navigation links */}
        <nav className="hidden md:flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => router.push('/dashboard')}
            className={`text-sm rounded-xl px-4 py-2 ${
              pathname === '/dashboard' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/10 font-bold' : ''
            }`}
          >
            <LayoutDashboard className="h-4 w-4 mr-2" />
            Dasbor Siswa
          </Button>

          <Button
            variant="ghost"
            onClick={() => router.push('/courses')}
            className={`text-sm rounded-xl px-4 py-2 ${
              pathname.startsWith('/courses') ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/10 font-bold' : ''
            }`}
          >
            <BookOpen className="h-4 w-4 mr-2" />
            Katalog Kursus
          </Button>

          {isInstructor && (
            <Button
              variant="ghost"
              onClick={() => router.push('/instructor')}
              className={`text-sm rounded-xl px-4 py-2 ${
                pathname === '/instructor' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/10 font-bold' : ''
              }`}
            >
              <FolderLock className="h-4 w-4 mr-2" />
              Dasbor Pengajar
            </Button>
          )}
        </nav>

        {/* User actions / notifications */}
        <div className="flex items-center gap-3">
          {/* Notifications bell */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowNotifications(!showNotifications);
                setShowUserMenu(false);
              }}
              className="p-2 rounded-xl text-zinc-400 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300 relative transition-colors"
            >
              <Bell className="h-5.5 w-5.5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 h-4 w-4 bg-rose-500 rounded-full text-[9px] font-extrabold text-white flex items-center justify-center animate-pulse">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Popover */}
            {showNotifications && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 mt-2 w-80 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl overflow-hidden z-50 py-1"
              >
                <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="font-bold text-sm text-zinc-900 dark:text-white">Notifikasi</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500"
                    >
                      Tandai dibaca semua
                    </button>
                  )}
                </div>

                <div className="max-h-64 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-zinc-400 italic">
                      Tidak ada notifikasi.
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => {
                          if (notif.link) router.push(notif.link);
                          setShowNotifications(false);
                        }}
                        className={`p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors ${
                          !notif.isRead ? 'bg-indigo-50/20 dark:bg-indigo-500/5' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {notif.type === 'enrollment' ? (
                            <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                          ) : (
                            <AlertCircle className="h-4.5 w-4.5 text-indigo-500 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="space-y-0.5 min-w-0">
                            <h5 className="font-semibold text-xs text-zinc-900 dark:text-white truncate">
                              {notif.title}
                            </h5>
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal line-clamp-2">
                              {notif.message}
                            </p>
                            <span className="text-[9px] text-zinc-400 block pt-0.5">
                              {new Date(notif.createdAt).toLocaleDateString('id-ID')}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User menu avatar */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowUserMenu(!showUserMenu);
                setShowNotifications(false);
              }}
              className="flex items-center gap-1 hover:opacity-85 transition-opacity"
            >
              <div className="h-9 w-9 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full flex items-center justify-center text-zinc-600 dark:text-zinc-300">
                <User className="h-5 w-5" />
              </div>
              <ChevronDown className="h-3 w-3 text-zinc-400 hidden sm:inline-block" />
            </button>

            {/* User Dropdown */}
            {showUserMenu && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl overflow-hidden z-50 py-1"
              >
                <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
                  <p className="font-bold text-xs text-zinc-900 dark:text-white truncate">
                    {session?.user?.name || 'Pelajar'}
                  </p>
                  <p className="text-[10px] text-zinc-400 truncate">
                    {session?.user?.email || ''}
                  </p>
                </div>

                <div className="py-1">
                  <button
                    onClick={() => {
                      router.push('/dashboard');
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2"
                  >
                    <LayoutDashboard className="h-4 w-4 text-zinc-400" />
                    Dasbor Siswa
                  </button>

                  <button
                    onClick={() => {
                      router.push('/courses');
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2"
                  >
                    <BookOpen className="h-4 w-4 text-zinc-400" />
                    Katalog Kursus
                  </button>

                  {isInstructor && (
                    <button
                      onClick={() => {
                        router.push('/instructor');
                        setShowUserMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2"
                    >
                      <FolderLock className="h-4 w-4 text-zinc-400" />
                      Dasbor Pengajar
                    </button>
                  )}
                </div>

                <div className="border-t border-zinc-100 dark:border-zinc-800 py-1">
                  <button
                    onClick={() => signOut({ callbackUrl: '/login' })}
                    className="w-full text-left px-4 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 flex items-center gap-2"
                  >
                    <LogOut className="h-4 w-4" />
                    Keluar Akun
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
