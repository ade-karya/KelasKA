'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  BookOpen,
  Clock,
  Play,
  CheckCircle2,
  Lock,
  Loader2,
  Calendar,
  Sparkles,
  Users,
  Award,
  AlertCircle,
  MessageSquare,
  Pin,
  CheckCircle,
  Send,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type Lesson = {
  id: string;
  title: string;
  description: string | null;
  order: number;
  duration: number | null;
  isFree: boolean;
  classroomId: string | null;
};

type Course = {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  category: string | null;
  isFree: boolean;
  maxStudents: number | null;
  enrollStart: string | null;
  enrollEnd: string | null;
  lessons: Lesson[];
  _count: { enrollments: number };
};

type Enrollment = {
  id: string;
  status: string;
};

type Progress = {
  lessonId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
};

type DiscussionThread = {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  isResolved: boolean;
  createdAt: string;
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  _count: { replies: number };
};

type DiscussionReply = {
  id: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
};

export default function CourseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();
  const courseId = params.id as string;

  const [course, setCourse] = useState<Course | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [progressList, setProgressList] = useState<Progress[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollLoading, setEnrollLoading] = useState(false);

  // Tabs: 'lessons' | 'discussions'
  const [activeTab, setActiveTab] = useState<'lessons' | 'discussions'>('lessons');

  // Discussions state
  const [discussions, setDiscussions] = useState<DiscussionThread[]>([]);
  const [discussionsLoading, setDiscussionsLoading] = useState(false);
  const [selectedThread, setSelectedThread] = useState<DiscussionThread | null>(null);
  const [threadReplies, setThreadReplies] = useState<DiscussionReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);

  // Form states
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadContent, setNewThreadContent] = useState('');
  const [newReplyContent, setNewReplyContent] = useState('');
  const [postLoading, setPostLoading] = useState(false);
  const [showCreateThread, setShowCreateThread] = useState(false);

  useEffect(() => {
    fetchCourseDetail();
  }, [courseId]);

  useEffect(() => {
    if (activeTab === 'discussions') {
      fetchDiscussions();
    }
  }, [activeTab, courseId]);

  const fetchCourseDetail = async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}`);
      if (res.ok) {
        const data = await res.json();
        setCourse(data.course);
        setEnrollment(data.enrollment);
        setProgressList(data.progress || []);
      } else {
        toast.error('Gagal memuat detail kursus');
      }
    } catch (err) {
      console.error(err);
      toast.error('Terjadi kesalahan koneksi');
    } finally {
      setLoading(false);
    }
  };

  const fetchDiscussions = async () => {
    setDiscussionsLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/discussions`);
      if (res.ok) {
        const data = await res.json();
        setDiscussions(data.discussions || []);
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal memuat diskusi');
    } finally {
      setDiscussionsLoading(false);
    }
  };

  const fetchThreadDetails = async (threadId: string) => {
    setRepliesLoading(true);
    try {
      const res = await fetch(`/api/discussions/${threadId}`);
      if (res.ok) {
        const data = await res.json();
        setThreadReplies(data.discussion.replies || []);
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal memuat balasan diskusi');
    } finally {
      setRepliesLoading(false);
    }
  };

  const handleEnroll = async () => {
    if (authStatus === 'unauthenticated') {
      router.push(`/login?callbackUrl=/courses/${courseId}`);
      return;
    }

    setEnrollLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/enroll`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Berhasil mendaftar kursus!');
        setEnrollment(data.enrollment);
        fetchCourseDetail();
      } else {
        toast.error(data.error || 'Gagal mendaftar');
      }
    } catch (err) {
      console.error(err);
      toast.error('Gagal menghubungi server');
    } finally {
      setEnrollLoading(false);
    }
  };

  const handleStartLesson = async (lesson: Lesson) => {
    if (!enrollment && !lesson.isFree) {
      toast.error('Silakan daftar terlebih dahulu untuk mengakses pelajaran ini');
      return;
    }

    try {
      await fetch(`/api/progress/${lesson.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'IN_PROGRESS' }),
      });
    } catch (err) {
      console.error(err);
    }

    if (lesson.classroomId) {
      router.push(`/classroom/${lesson.classroomId}`);
    } else {
      router.push(`/courses/${courseId}/learn?lessonId=${lesson.id}`);
    }
  };

  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newThreadTitle.trim() || !newThreadContent.trim()) {
      toast.error('Judul dan Konten wajib diisi');
      return;
    }

    setPostLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/discussions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newThreadTitle,
          content: newThreadContent,
        }),
      });
      if (res.ok) {
        toast.success('Diskusi berhasil dibuat!');
        setNewThreadTitle('');
        setNewThreadContent('');
        setShowCreateThread(false);
        fetchDiscussions();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Gagal membuat diskusi');
      }
    } catch (err) {
      console.error(err);
      toast.error('Kesalahan koneksi');
    } finally {
      setPostLoading(false);
    }
  };

  const handleCreateReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReplyContent.trim() || !selectedThread) return;

    setPostLoading(true);
    try {
      const res = await fetch(`/api/discussions/${selectedThread.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newReplyContent }),
      });
      if (res.ok) {
        const data = await res.json();
        setThreadReplies((prev) => [...prev, data.reply]);
        setNewReplyContent('');
        toast.success('Balasan dikirim!');
        // Update reply count locally
        setDiscussions((prev) =>
          prev.map((d) =>
            d.id === selectedThread.id
              ? { ...d, _count: { replies: d._count.replies + 1 } }
              : d
          )
        );
      } else {
        const data = await res.json();
        toast.error(data.error || 'Gagal mengirim balasan');
      }
    } catch (err) {
      console.error(err);
      toast.error('Kesalahan koneksi');
    } finally {
      setPostLoading(false);
    }
  };

  const handleSelectThread = (thread: DiscussionThread) => {
    setSelectedThread(thread);
    fetchThreadDetails(thread.id);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6 text-center">
        <AlertCircle className="h-12 w-12 text-rose-500 mb-4" />
        <h1 className="text-xl font-bold">Kursus tidak ditemukan</h1>
        <Button onClick={() => router.push('/courses')} className="mt-4">
          Kembali ke Katalog
        </Button>
      </div>
    );
  }

  const isEnrolled = enrollment && enrollment.status === 'ACTIVE';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-16">
      {/* Header Banner */}
      <div className="relative bg-zinc-900 text-white overflow-hidden py-12 md:py-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/20 via-purple-500/10 to-transparent pointer-events-none" />
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/courses')}
              className="text-white/70 hover:text-white hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Katalog
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
            {/* Title / Description */}
            <div className="md:col-span-2 space-y-4">
              {course.category && (
                <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider">
                  {course.category}
                </span>
              )}
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                {course.title}
              </h1>
              <p className="text-zinc-400 text-sm sm:text-base leading-relaxed">
                {course.description || 'Tidak ada deskripsi tersedia untuk kursus ini.'}
              </p>

              <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400 pt-2">
                <span className="flex items-center gap-1">
                  <BookOpen className="h-4 w-4" />
                  {course.lessons.length} Pelajaran
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {course._count.enrollments} Siswa Terdaftar
                </span>
                {course.enrollEnd && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    Hingga {new Date(course.enrollEnd).toLocaleDateString('id-ID')}
                  </span>
                )}
              </div>
            </div>

            {/* CTA Box */}
            <div className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl p-6 border border-zinc-200 dark:border-zinc-800 shadow-xl space-y-4">
              <div className="aspect-video bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl overflow-hidden relative">
                {course.thumbnail && (
                  <img
                    src={course.thumbnail}
                    alt={course.title}
                    className="w-full h-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-black/10" />
              </div>

              {isEnrolled ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-semibold justify-center bg-emerald-50 dark:bg-emerald-500/10 py-2 rounded-xl">
                    <CheckCircle2 className="h-5 w-5" />
                    Terdaftar Aktif
                  </div>
                  <Button
                    onClick={() => {
                      if (course.lessons.length > 0) handleStartLesson(course.lessons[0]);
                    }}
                    className="w-full py-6 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl"
                  >
                    Mulai Belajar
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={handleEnroll}
                  disabled={enrollLoading}
                  className="w-full py-6 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20"
                >
                  {enrollLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Mendaftarkan...
                    </span>
                  ) : (
                    'Daftar Kursus Sekarang'
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-30">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 flex gap-6">
          <button
            onClick={() => setActiveTab('lessons')}
            className={`py-4 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'lessons'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            Materi Pelajaran
          </button>
          <button
            onClick={() => setActiveTab('discussions')}
            className={`py-4 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'discussions'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            Forum Diskusi
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 mt-8 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2">
          <AnimatePresence mode="wait">
            {activeTab === 'lessons' ? (
              <motion.div
                key="lessons"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-indigo-500" />
                  Materi Pelajaran ({course.lessons.length})
                </h2>

                {course.lessons.length === 0 ? (
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-500">
                    Pelajaran belum ditambahkan ke kursus ini.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {course.lessons.map((lesson) => {
                      const isCompleted = progressList.some(
                        (p) => p.lessonId === lesson.id && p.status === 'COMPLETED'
                      );
                      const isInProgress = progressList.some(
                        (p) => p.lessonId === lesson.id && p.status === 'IN_PROGRESS'
                      );
                      const canAccess = isEnrolled || lesson.isFree;

                      return (
                        <div
                          key={lesson.id}
                          className={`bg-white dark:bg-zinc-900 rounded-2xl border p-4 flex items-center justify-between transition-all ${
                            canAccess
                              ? 'border-zinc-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-700 cursor-pointer'
                              : 'border-zinc-100 dark:border-zinc-900 opacity-60'
                          }`}
                          onClick={() => canAccess && handleStartLesson(lesson)}
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex-shrink-0">
                              {isCompleted ? (
                                <div className="h-9 w-9 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center">
                                  <CheckCircle2 className="h-5 w-5" />
                                </div>
                              ) : isInProgress ? (
                                <div className="h-9 w-9 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center">
                                  <Play className="h-5 w-5 animate-pulse" />
                                </div>
                              ) : !canAccess ? (
                                <div className="h-9 w-9 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-xl flex items-center justify-center">
                                  <Lock className="h-4 w-4" />
                                </div>
                              ) : (
                                <div className="h-9 w-9 bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded-xl flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                                  <span className="text-xs font-bold">{lesson.order}</span>
                                </div>
                              )}
                            </div>

                            <div>
                              <h3 className="font-semibold text-zinc-900 dark:text-white text-sm sm:text-base">
                                {lesson.title}
                              </h3>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500">
                                {lesson.duration && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {lesson.duration} menit
                                  </span>
                                )}
                                {lesson.isFree && !isEnrolled && (
                                  <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold px-2 py-0.5 rounded-full text-[10px] uppercase">
                                    Gratis
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {canAccess && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500"
                            >
                              Mulai <Play className="h-3.5 w-3.5 ml-1" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="discussions"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                {selectedThread ? (
                  /* Expanded Thread View */
                  <div className="space-y-4">
                    <Button
                      variant="ghost"
                      onClick={() => setSelectedThread(null)}
                      className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" /> Kembali ke Forum
                    </Button>

                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
                          <User className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-bold text-zinc-900 dark:text-white">
                            {selectedThread.user.name}
                          </h4>
                          <span className="text-xs text-zinc-400">
                            Diposting pada {new Date(selectedThread.createdAt).toLocaleDateString('id-ID')}
                          </span>
                        </div>
                      </div>
                      <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
                        {selectedThread.title}
                      </h3>
                      <p className="text-zinc-700 dark:text-zinc-300 text-sm whitespace-pre-line leading-relaxed">
                        {selectedThread.content}
                      </p>
                    </div>

                    {/* Replies list */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                        Komentar ({threadReplies.length})
                      </h4>
                      {repliesLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                        </div>
                      ) : threadReplies.length === 0 ? (
                        <p className="text-zinc-500 text-sm italic">Belum ada komentar.</p>
                      ) : (
                        threadReplies.map((reply) => (
                          <div
                            key={reply.id}
                            className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800/80 rounded-2xl p-4 space-y-2 shadow-sm ml-6"
                          >
                            <div className="flex items-center gap-2">
                              <div className="h-8 w-8 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-600">
                                <User className="h-4 w-4" />
                              </div>
                              <div>
                                <span className="font-semibold text-xs text-zinc-800 dark:text-zinc-200">
                                  {reply.user.name}
                                </span>
                                <span className="text-[10px] text-zinc-400 ml-2">
                                  {new Date(reply.createdAt).toLocaleDateString('id-ID')}
                                </span>
                              </div>
                            </div>
                            <p className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed">
                              {reply.content}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Post Reply Form */}
                    {isEnrolled || authStatus === 'authenticated' ? (
                      <form onSubmit={handleCreateReply} className="space-y-3 pt-2">
                        <Textarea
                          placeholder="Tulis balasan Anda..."
                          value={newReplyContent}
                          onChange={(e) => setNewReplyContent(e.target.value)}
                          rows={3}
                          className="rounded-xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                        />
                        <div className="flex justify-end">
                          <Button
                            type="submit"
                            disabled={postLoading || !newReplyContent.trim()}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl"
                          >
                            {postLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <Send className="h-4 w-4 mr-2" />
                            )}
                            Kirim Balasan
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                ) : (
                  /* Thread List View */
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-indigo-500" />
                        Forum Diskusi
                      </h2>
                      {isEnrolled && (
                        <Button
                          onClick={() => setShowCreateThread(!showCreateThread)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl"
                        >
                          {showCreateThread ? 'Batal' : 'Buat Diskusi'}
                        </Button>
                      )}
                    </div>

                    {/* Create Thread Form */}
                    {showCreateThread && (
                      <motion.form
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        onSubmit={handleCreateThread}
                        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4 shadow-sm"
                      >
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-zinc-500">Judul Diskusi</label>
                          <Input
                            placeholder="Apa yang ingin Anda tanyakan?"
                            value={newThreadTitle}
                            onChange={(e) => setNewThreadTitle(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-zinc-500">Konten Pertanyaan</label>
                          <Textarea
                            placeholder="Jelaskan pertanyaan atau topik diskusi secara lengkap..."
                            value={newThreadContent}
                            onChange={(e) => setNewThreadContent(e.target.value)}
                            rows={4}
                            required
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setShowCreateThread(false)}
                          >
                            Batal
                          </Button>
                          <Button
                            type="submit"
                            disabled={postLoading}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white"
                          >
                            {postLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Posting Diskusi
                          </Button>
                        </div>
                      </motion.form>
                    )}

                    {discussionsLoading ? (
                      <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                      </div>
                    ) : discussions.length === 0 ? (
                      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-500">
                        Belum ada topik diskusi. Jadilah yang pertama bertanya!
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {discussions.map((thread) => (
                          <div
                            key={thread.id}
                            onClick={() => handleSelectThread(thread)}
                            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all cursor-pointer shadow-sm flex items-start gap-4"
                          >
                            <div className="flex-shrink-0 h-10 w-10 bg-indigo-50 dark:bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                              <User className="h-5 w-5" />
                            </div>

                            <div className="flex-grow min-w-0 space-y-1">
                              <div className="flex items-center gap-2">
                                <h3 className="font-bold text-zinc-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 text-sm sm:text-base line-clamp-1">
                                  {thread.title}
                                </h3>
                                {thread.isPinned && (
                                  <Pin className="h-3 w-3 text-rose-500 fill-rose-500 flex-shrink-0" />
                                )}
                                {thread.isResolved && (
                                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                                {thread.content}
                              </p>

                              <div className="flex items-center gap-3 pt-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                                <span>{thread.user.name}</span>
                                <span>·</span>
                                <span>{thread._count.replies} balasan</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Benefits Sidebar */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
            <h3 className="font-bold text-zinc-900 dark:text-white">
              Fitur Utama Kursus
            </h3>
            <ul className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
              <li className="flex items-start gap-2.5">
                <Sparkles className="h-4 w-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                <span>Materi didukung simulasi interaktif AI classroom.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Users className="h-4 w-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                <span>Interaksi dengan AI agent multi-guru & diskusi.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Award className="h-4 w-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                <span>Sertifikat kelulusan setelah menyelesaikan materi.</span>
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
