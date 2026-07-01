'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  BookOpen,
  Plus,
  Users,
  Trash2,
  CheckCircle,
  Eye,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { DashboardHeader } from '@/components/dashboard-header';

type Course = {
  id: string;
  title: string;
  category: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  _count: { lessons: number; enrollments: number };
};

export default function InstructorDashboardPage() {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  // Redirect if not logged in
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    } else if (authStatus === 'authenticated') {
      fetchInstructorCourses();
    }
  }, [authStatus]);

  const fetchInstructorCourses = async () => {
    try {
      const res = await fetch('/api/courses');
      if (res.ok) {
        const data = await res.json();
        setCourses(data.courses || []);
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal memuat daftar kursus');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCourse = async () => {
    const title = prompt('Masukkan Judul Kursus Baru:');
    if (!title) return;

    try {
      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        toast.success('Kursus berhasil dibuat!');
        fetchInstructorCourses();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Gagal membuat kursus');
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal menghubungi server');
    }
  };

  const handleTogglePublish = async (course: Course) => {
    const nextStatus = course.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    try {
      const res = await fetch(`/api/courses/${course.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        toast.success(
          nextStatus === 'PUBLISHED'
            ? 'Kursus berhasil dipublikasikan!'
            : 'Kursus disimpan kembali sebagai draf.'
        );
        fetchInstructorCourses();
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal memperbarui status');
    }
  };

  const handleDeleteCourse = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus kursus ini? Semua data pelajaran dan kemajuan siswa akan dihapus.')) return;

    try {
      const res = await fetch(`/api/courses/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('Kursus berhasil dihapus');
        fetchInstructorCourses();
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal menghapus kursus');
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <DashboardHeader />

      {/* Action Banner */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white">
              Dasbor Pengajar
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Kelola materi pembelajaran, pelajaran AI, dan lihat statistik pengajaran.
            </p>
          </div>
          <div>
            <Button
              onClick={handleCreateCourse}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-500/20"
            >
              <Plus className="h-4 w-4 mr-2" />
              Kursus Baru
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
            Kelola Kursus Saya
          </h2>

          {courses.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-12 text-center">
              <div className="mx-auto w-16 h-16 bg-indigo-50 dark:bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-4">
                <BookOpen className="h-8 w-8 text-indigo-500" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                Belum membuat kursus
              </h3>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
                Mulai dengan membuat kursus pertama Anda untuk menambahkan materi pelajaran interaktif.
              </p>
              <Button
                onClick={handleCreateCourse}
                className="mt-6 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg"
              >
                Buat Kursus Pertama
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {courses.map((course) => (
                <div
                  key={course.id}
                  className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div className="p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                        course.status === 'PUBLISHED'
                          ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                      }`}>
                        {course.status === 'PUBLISHED' ? 'Publik' : 'Draft'}
                      </span>
                      {course.category && (
                        <span className="text-xs text-zinc-400 font-medium">
                          {course.category}
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-zinc-900 dark:text-white text-base line-clamp-1">
                      {course.title}
                    </h3>

                    <div className="flex items-center gap-4 text-xs text-zinc-500">
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-3.5 w-3.5" />
                        {course._count.lessons} Pelajaran
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {course._count.enrollments} Siswa
                      </span>
                    </div>
                  </div>

                  <div className="p-4 border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/30 flex items-center justify-between gap-2">
                    <div className="flex gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push(`/courses/${course.id}`)}
                        className="text-zinc-600 dark:text-zinc-400"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTogglePublish(course)}
                        className={course.status === 'PUBLISHED' ? 'text-emerald-500' : 'text-zinc-400'}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteCourse(course.id)}
                      className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
    );
  }
