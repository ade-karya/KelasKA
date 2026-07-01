'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  BookOpen,
  Clock,
  Trophy,
  TrendingUp,
  GraduationCap,
  ChevronRight,
  Play,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

import { DashboardHeader } from '@/components/dashboard-header';

type EnrolledCourse = {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  category: string | null;
  _count: { lessons: number };
  completedLessons: number;
  totalTimeSpent: number;
};

type DashboardStats = {
  totalCourses: number;
  completedCourses: number;
  totalTimeSpent: number;
  currentStreak: number;
};

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalCourses: 0,
    completedCourses: 0,
    totalTimeSpent: 0,
    currentStreak: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }

    if (status === 'authenticated') {
      fetchDashboardData();
    }
  }, [status]);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        const data = await res.json();
        setEnrolledCourses(data.enrolledCourses || []);
        setStats(data.stats || stats);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}j ${mins}m`;
    return `${mins} menit`;
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  const userName = session?.user?.name?.split(' ')[0] || 'Pelajar';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <DashboardHeader />

      {/* Hero Welcome Banner */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.h1
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xl font-bold text-zinc-900 dark:text-white"
          >
            Selamat datang kembali, {userName}! 👋
          </motion.h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Lanjutkan petualangan belajar Anda hari ini.
          </p>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {[
            {
              label: 'Kursus Diikuti',
              value: stats.totalCourses,
              icon: BookOpen,
              color: 'text-indigo-500',
              bg: 'bg-indigo-50 dark:bg-indigo-500/10',
            },
            {
              label: 'Kursus Selesai',
              value: stats.completedCourses,
              icon: Trophy,
              color: 'text-emerald-500',
              bg: 'bg-emerald-50 dark:bg-emerald-500/10',
            },
            {
              label: 'Total Waktu Belajar',
              value: formatTime(stats.totalTimeSpent),
              icon: Clock,
              color: 'text-amber-500',
              bg: 'bg-amber-50 dark:bg-amber-500/10',
            },
            {
              label: 'Hari Beruntun',
              value: `${stats.currentStreak} hari`,
              icon: TrendingUp,
              color: 'text-rose-500',
              bg: 'bg-rose-50 dark:bg-rose-500/10',
            },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className="bg-white dark:bg-zinc-900 rounded-2xl p-5 border border-zinc-100 dark:border-zinc-800 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${stat.bg}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {stat.label}
                  </p>
                  <p className="text-xl font-bold text-zinc-900 dark:text-white mt-0.5">
                    {stat.value}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Enrolled Courses */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
              Kursus Saya
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/courses')}
              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500"
            >
              Lihat Semua <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>

          {enrolledCourses.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-12 text-center">
              <div className="mx-auto w-16 h-16 bg-indigo-50 dark:bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-4">
                <BookOpen className="h-8 w-8 text-indigo-500" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                Belum ada kursus
              </h3>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
                Anda belum mengikuti kursus apa pun. Jelajahi katalog kursus dan mulai belajar sekarang!
              </p>
              <Button
                onClick={() => router.push('/courses')}
                className="mt-6 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
              >
                Jelajahi Kursus
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {enrolledCourses.map((course, i) => {
                const progressPercent =
                  course._count.lessons > 0
                    ? Math.round((course.completedLessons / course._count.lessons) * 100)
                    : 0;

                return (
                  <motion.div
                    key={course.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * i }}
                    className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
                    onClick={() => router.push(`/courses/${course.id}`)}
                  >
                    {/* Thumbnail */}
                    <div className="h-36 bg-gradient-to-br from-indigo-500 to-purple-600 relative overflow-hidden">
                      {course.thumbnail && (
                        <img
                          src={course.thumbnail}
                          alt={course.title}
                          className="w-full h-full object-cover"
                        />
                      )}
                      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <div className="bg-white/90 rounded-full p-3">
                          <Play className="h-5 w-5 text-indigo-600" />
                        </div>
                      </div>
                      {course.category && (
                        <span className="absolute top-3 left-3 bg-black/40 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-full">
                          {course.category}
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-4">
                      <h3 className="font-semibold text-zinc-900 dark:text-white line-clamp-1">
                        {course.title}
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        {course._count.lessons} pelajaran
                        {course.totalTimeSpent > 0 && ` · ${formatTime(course.totalTimeSpent)}`}
                      </p>

                      {/* Progress bar */}
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-zinc-500 dark:text-zinc-400">
                            Progres
                          </span>
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                            {progressPercent}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.section>
      </main>
    </div>
  );
}
