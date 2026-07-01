'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  PlayCircle,
  Clock,
  Award,
  Loader2,
  AlertCircle,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type Lesson = {
  id: string;
  title: string;
  description: string | null;
  order: number;
  duration: number | null;
  classroomId: string | null;
  classroomData: any;
};

type Course = {
  id: string;
  title: string;
  lessons: Lesson[];
};

type Progress = {
  lessonId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  timeSpent: number;
};

export default function CourseLearnPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: authStatus } = useSession();

  const [course, setCourse] = useState<Course | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
  const [progressList, setProgressList] = useState<Progress[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const timeStartRef = useRef<number>(Date.now());

  // Redirect if not logged in
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus]);

  // Load course details
  useEffect(() => {
    const courseId = window.location.pathname.split('/')[2];
    if (courseId) {
      fetchCourseDetails(courseId);
    }
  }, []);

  // Track time spent on the current lesson
  useEffect(() => {
    timeStartRef.current = Date.now();

    return () => {
      // Save progress (time spent) when leaving or changing lesson
      if (currentLesson) {
        const timeSpentSeconds = Math.round((Date.now() - timeStartRef.current) / 1000);
        if (timeSpentSeconds > 0) {
          updateLessonProgress(currentLesson.id, 'IN_PROGRESS', timeSpentSeconds);
        }
      }
    };
  }, [currentLesson?.id]);

  const fetchCourseDetails = async (courseId: string) => {
    try {
      const res = await fetch(`/api/courses/${courseId}`);
      if (res.ok) {
        const data = await res.json();
        setCourse(data.course);
        setLessons(data.course.lessons || []);
        setProgressList(data.progress || []);

        // Determine current lesson based on query param or first incomplete lesson
        const paramLessonId = searchParams.get('lessonId');
        if (paramLessonId) {
          const found = data.course.lessons.find((l: Lesson) => l.id === paramLessonId);
          if (found) setCurrentLesson(found);
        } else if (data.course.lessons.length > 0) {
          // Default to first incomplete lesson
          const nextIncomplete = data.course.lessons.find((l: Lesson) => {
            const p = data.progress?.find((prog: Progress) => prog.lessonId === l.id);
            return !p || p.status !== 'COMPLETED';
          });
          setCurrentLesson(nextIncomplete || data.course.lessons[0]);
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal memuat materi');
    } finally {
      setLoading(false);
    }
  };

  const updateLessonProgress = async (
    lessonId: string,
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED',
    timeSpent: number = 0
  ) => {
    try {
      const res = await fetch(`/api/progress/${lessonId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, timeSpent }),
      });
      if (res.ok) {
        const data = await res.json();
        // Update local progress list state
        setProgressList((prev) => {
          const filtered = prev.filter((p) => p.lessonId !== lessonId);
          return [
            ...filtered,
            {
              lessonId,
              status: data.progress.status,
              timeSpent: data.progress.timeSpent,
            },
          ];
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCompleteLesson = async () => {
    if (!currentLesson) return;
    setActionLoading(true);

    const timeSpentSeconds = Math.round((Date.now() - timeStartRef.current) / 1000);
    await updateLessonProgress(currentLesson.id, 'COMPLETED', timeSpentSeconds);
    toast.success('Pelajaran selesai!');

    // Reset timer start for next actions
    timeStartRef.current = Date.now();

    // Check if there is a next lesson
    const currentIndex = lessons.findIndex((l) => l.id === currentLesson.id);
    if (currentIndex !== -1 && currentIndex < lessons.length - 1) {
      setCurrentLesson(lessons[currentIndex + 1]);
    } else {
      // All lessons completed
      toast.success('Selamat! Anda telah menyelesaikan semua pelajaran di kursus ini.');
    }
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!course || !currentLesson) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6 text-center">
        <AlertCircle className="h-12 w-12 text-rose-500 mb-4" />
        <h1 className="text-xl font-bold">Gagal memuat ruang belajar</h1>
        <Button onClick={() => router.push('/courses')} className="mt-4">
          Kembali ke Katalog
        </Button>
      </div>
    );
  }

  const isCurrentCompleted = progressList.some(
    (p) => p.lessonId === currentLesson.id && p.status === 'COMPLETED'
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col md:flex-row">
      {/* Sidebar: Lesson Navigation */}
      <aside className="w-full md:w-80 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/courses/${course.id}`)}
            className="p-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="overflow-hidden">
            <h1 className="font-bold text-sm text-zinc-900 dark:text-white line-clamp-1">
              {course.title}
            </h1>
            <span className="text-xs text-zinc-500">Materi Pelajaran</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {lessons.map((lesson) => {
            const isSelected = lesson.id === currentLesson.id;
            const isComp = progressList.some(
              (p) => p.lessonId === lesson.id && p.status === 'COMPLETED'
            );

            return (
              <button
                key={lesson.id}
                onClick={() => setCurrentLesson(lesson)}
                className={`w-full text-left p-3.5 rounded-xl flex items-center justify-between text-sm transition-all ${
                  isSelected
                    ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400">{lesson.order}.</span>
                  <span className="line-clamp-1">{lesson.title}</span>
                </div>
                {isComp ? (
                  <CheckCircle className="h-4.5 w-4.5 text-emerald-500 flex-shrink-0" />
                ) : (
                  <PlayCircle className="h-4.5 w-4.5 text-zinc-300 dark:text-zinc-700 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main Study Area */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              Pelajaran {currentLesson.order}
            </span>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white line-clamp-1">
              {currentLesson.title}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={lessons.findIndex((l) => l.id === currentLesson.id) === 0}
              onClick={() => {
                const idx = lessons.findIndex((l) => l.id === currentLesson.id);
                if (idx > 0) setCurrentLesson(lessons[idx - 1]);
              }}
              className="p-2 border-zinc-200 dark:border-zinc-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              disabled={lessons.findIndex((l) => l.id === currentLesson.id) === lessons.length - 1}
              onClick={() => {
                const idx = lessons.findIndex((l) => l.id === currentLesson.id);
                if (idx !== -1 && idx < lessons.length - 1) setCurrentLesson(lessons[idx + 1]);
              }}
              className="p-2 border-zinc-200 dark:border-zinc-800"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Content Viewer / Simulation Area */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6 max-w-4xl">
          {currentLesson.classroomId ? (
            <div className="bg-gradient-to-tr from-indigo-50 to-indigo-100 dark:from-zinc-900 dark:to-zinc-900/50 rounded-2xl border border-indigo-100 dark:border-zinc-800 p-8 text-center space-y-4 shadow-sm">
              <div className="mx-auto w-16 h-16 bg-white dark:bg-zinc-800 rounded-2xl flex items-center justify-center shadow-md">
                <BookOpen className="h-8 w-8 text-indigo-500" />
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
                  AI Classroom Interaktif Tersedia
                </h3>
                <p className="text-sm text-zinc-500 mt-1">
                  Pelajaran ini memiliki simulasi multi-agent interaktif penuh, suara guru AI, kuis instan, dan papan tulis diagram.
                </p>
              </div>
              <Button
                onClick={() => router.push(`/classroom/${currentLesson.classroomId}`)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-500/25 px-6"
              >
                Buka AI Classroom <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 space-y-6">
              <article className="prose dark:prose-invert max-w-none text-zinc-800 dark:text-zinc-200">
                <p className="leading-relaxed">
                  {currentLesson.description || 'Tidak ada deskripsi tertulis untuk pelajaran ini.'}
                </p>
              </article>
            </div>
          )}

          {/* Complete Checklist */}
          <div className="flex justify-end pt-4">
            {isCurrentCompleted ? (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-500/10 px-4 py-2.5 rounded-xl text-sm border border-emerald-100 dark:border-emerald-500/20">
                <CheckCircle className="h-4.5 w-4.5" />
                Selesai Dipelajari
              </div>
            ) : (
              <Button
                onClick={handleCompleteLesson}
                disabled={actionLoading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-500/20 rounded-xl px-5"
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Tandai Selesai
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
