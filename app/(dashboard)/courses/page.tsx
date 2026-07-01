'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  BookOpen,
  Users,
  Clock,
  ChevronRight,
  Filter,
  GraduationCap,
  Loader2,
  ArrowLeft,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Course = {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  category: string | null;
  tags: string[];
  isFree: boolean;
  status: string;
  _count: { lessons: number; enrollments: number };
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const CATEGORIES = [
  'Semua',
  'Matematika',
  'Fisika',
  'Kimia',
  'Biologi',
  'Bahasa',
  'Komputer',
  'Bisnis',
  'Seni',
  'Lainnya',
];

export default function CourseCatalogPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Semua');
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 12,
    total: 0,
    totalPages: 0,
  });

  useEffect(() => {
    fetchCourses();
  }, [search, category, pagination.page]);

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pagination.page));
      params.set('limit', String(pagination.limit));
      params.set('status', 'PUBLISHED');
      if (search) params.set('search', search);
      if (category !== 'Semua') params.set('category', category);

      const res = await fetch(`/api/courses?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCourses(data.courses || []);
        setPagination(data.pagination || pagination);
      }
    } catch (err) {
      console.error('Failed to fetch courses:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Hero Section */}
      <div className="relative bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.05%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-30" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/dashboard')}
              className="text-white/70 hover:text-white hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Dashboard
            </Button>
          </div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight"
          >
            Katalog Kursus
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-3 text-lg text-indigo-100 max-w-2xl"
          >
            Temukan kursus interaktif dengan guru AI dan teman sekelas AI. Belajar lebih menyenangkan!
          </motion.p>

          {/* Search Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-8 max-w-xl"
          >
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400" />
              <Input
                type="text"
                placeholder="Cari kursus..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-12 py-7 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-0 shadow-2xl shadow-black/10 rounded-2xl text-base placeholder:text-zinc-400"
              />
            </div>
          </motion.div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Category Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 scrollbar-hide">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setCategory(cat);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                category === cat
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                  : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Results info */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {pagination.total} kursus ditemukan
          </p>
        </div>

        {/* Course Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        ) : courses.length === 0 ? (
          <div className="text-center py-24">
            <div className="mx-auto w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center mb-4">
              <BookOpen className="h-8 w-8 text-zinc-400" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
              Belum ada kursus
            </h3>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {search
                ? `Tidak ada kursus yang cocok dengan "${search}"`
                : 'Belum ada kursus yang tersedia saat ini.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            <AnimatePresence mode="popLayout">
              {courses.map((course, i) => (
                <motion.div
                  key={course.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: 0.03 * i }}
                  className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer group"
                  onClick={() => router.push(`/courses/${course.id}`)}
                >
                  {/* Thumbnail */}
                  <div className="h-40 bg-gradient-to-br from-indigo-500 to-purple-600 relative overflow-hidden">
                    {course.thumbnail ? (
                      <img
                        src={course.thumbnail}
                        alt={course.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <GraduationCap className="h-12 w-12 text-white/50" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />

                    {/* Badges */}
                    <div className="absolute top-3 left-3 flex gap-2">
                      {course.isFree && (
                        <span className="bg-emerald-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                          Gratis
                        </span>
                      )}
                      {course.category && (
                        <span className="bg-black/40 backdrop-blur-sm text-white text-[11px] font-medium px-2 py-0.5 rounded-full">
                          {course.category}
                        </span>
                      )}
                    </div>

                    {/* Play overlay */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="bg-white/90 rounded-full p-3 shadow-lg">
                        <Play className="h-5 w-5 text-indigo-600" />
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <h3 className="font-semibold text-zinc-900 dark:text-white line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {course.title}
                    </h3>
                    {course.description && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 line-clamp-2">
                        {course.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-3.5 w-3.5" />
                        {course._count.lessons} pelajaran
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {course._count.enrollments} siswa
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-10">
            {Array.from({ length: pagination.totalPages }, (_, i) => (
              <button
                key={i + 1}
                onClick={() => setPagination((p) => ({ ...p, page: i + 1 }))}
                className={`w-10 h-10 rounded-xl text-sm font-medium transition-all ${
                  pagination.page === i + 1
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                    : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-300'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
