'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  School,
  BookOpen,
  Plus,
  Trash2,
  X,
  Search,
  RefreshCw,
  Award,
  FileText,
  LayoutDashboard,
} from 'lucide-react';
import {
  getClasses,
  createClass,
  deleteClass,
  getStudentsWithDetails,
  createStudent,
  deleteStudent,
  addOrUpdateScore,
  getAssignments,
} from '@/lib/supabase/admin-queries';
import { useSupabaseAuth } from '@/lib/contexts/supabase-auth-context';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useSupabaseAuth();
  const [activeTab, setActiveTab] = useState<'students' | 'classes' | 'assignments'>('students');
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState('Semua Kelas');

  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [isAddClassOpen, setIsAddClassOpen] = useState(false);
  const [isAddScoreOpen, setIsAddScoreOpen] = useState(false);
  const [pendingDeleteStudentId, setPendingDeleteStudentId] = useState<string | null>(null);
  const [pendingDeleteClassId, setPendingDeleteClassId] = useState<string | null>(null);

  const [newStudent, setNewStudent] = useState({
    name: '',
    nim: '',
    class_name: 'KA-101',
    attendance_rate: '' as string | number,
    average_score: '' as string | number,
    status: '',
  });
  const [newClass, setNewClass] = useState({ name: '', description: '' });
  const [scoreForm, setScoreForm] = useState({
    student_id: '',
    subject_name: 'Pemrograman Web',
    score: '' as string | number,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/masuk?next=/admin');
    }
  }, [authLoading, user, router]);

  const loadData = async () => {
    setLoading(true);
    try {
      const cls = await getClasses().catch(() => []);
      setClasses(cls || []);
      const stds = await getStudentsWithDetails(selectedClassFilter, searchQuery).catch(() => []);
      setStudents(stds || []);
      const asg = await getAssignments().catch(() => []);
      setAssignments(asg || []);
    } catch (e) {
      console.error('Error loading admin data:', e);
      toast.error('Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassFilter, user]);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        name: newStudent.name,
        nim: newStudent.nim,
        class_name: newStudent.class_name,
        avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${newStudent.name}`,
      };
      if (newStudent.attendance_rate !== '' && newStudent.attendance_rate != null) payload.attendance_rate = Number(newStudent.attendance_rate);
      if (newStudent.average_score !== '' && newStudent.average_score != null) payload.average_score = Number(newStudent.average_score);
      if (newStudent.status) payload.status = newStudent.status;
      await createStudent(payload);
      toast.success('Siswa berhasil ditambahkan');
      setIsAddStudentOpen(false);
      setNewStudent({ name: '', nim: '', class_name: 'KA-101', attendance_rate: '', average_score: '', status: '' });
      loadData();
    } catch (e: any) {
      toast.error('Gagal menambah siswa: ' + e.message);
    }
  };

  const confirmDeleteStudent = async () => {
    if (!pendingDeleteStudentId) return;
    try {
      await deleteStudent(pendingDeleteStudentId);
      toast.success('Siswa dihapus');
      loadData();
    } catch (e: any) {
      toast.error('Gagal menghapus siswa: ' + e.message);
    } finally {
      setPendingDeleteStudentId(null);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createClass(newClass.name, newClass.description);
      toast.success('Kelas berhasil ditambahkan');
      setIsAddClassOpen(false);
      setNewClass({ name: '', description: '' });
      loadData();
    } catch (e: any) {
      toast.error('Gagal menambah kelas: ' + e.message);
    }
  };

  const confirmDeleteClass = async () => {
    if (!pendingDeleteClassId) return;
    try {
      await deleteClass(pendingDeleteClassId);
      toast.success('Kelas dihapus');
      loadData();
    } catch (e: any) {
      toast.error('Gagal menghapus kelas: ' + e.message);
    } finally {
      setPendingDeleteClassId(null);
    }
  };

  const handleSaveScore = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (scoreForm.score === '' || Number(scoreForm.score) < 0 || Number(scoreForm.score) > 100) {
        toast.error('Nilai harus 0–100');
        return;
      }
      await addOrUpdateScore(scoreForm.student_id, scoreForm.subject_name, Number(scoreForm.score));
      toast.success('Nilai disimpan');
      setIsAddScoreOpen(false);
      loadData();
    } catch (e: any) {
      toast.error('Gagal menyimpan nilai: ' + e.message);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 grid place-items-center text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 grid place-items-center p-6 text-center">
        <p className="text-sm text-slate-400">Mengalihkan ke /masuk …</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex font-sans">
      {/* Sidebar — same shell as dashboard per PRD §5.2 */}
      <aside className="w-64 bg-slate-900/80 backdrop-blur border-r border-slate-800 p-6 flex flex-col justify-between hidden md:flex">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-indigo-600 rounded-xl">
              <School className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-white">KelasKA</h1>
              <p className="text-xs text-slate-400">Admin • {user.email}</p>
            </div>
          </div>
          <nav className="space-y-2">
            <button onClick={() => setActiveTab('students')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'students' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'}`}>
              <Users className="w-5 h-5" /> Kelola Siswa
            </button>
            <button onClick={() => setActiveTab('classes')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'classes' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'}`}>
              <School className="w-5 h-5" /> Kelola Kelas
            </button>
            <button onClick={() => setActiveTab('assignments')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'assignments' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'}`}>
              <FileText className="w-5 h-5" /> Kelola Tugas
            </button>
          </nav>
        </div>
        <div className="border-t border-slate-700 pt-4 space-y-2">
          <button onClick={() => router.push('/dashboard')} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-300 hover:bg-slate-800">
            <LayoutDashboard className="w-4 h-4" /> Kembali ke Dashboard
          </button>
          <button onClick={() => router.push('/admin/activity-logs')} className="w-full text-left px-3 py-2 text-xs text-indigo-400 hover:underline">Log Aktivitas →</button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-20 bg-slate-900 border-b border-slate-800 p-3 flex items-center justify-between">
        <span className="font-bold text-white">Admin</span>
        <button onClick={() => router.push('/dashboard')} className="p-2 rounded-xl bg-slate-800 text-slate-300">Dashboard</button>
      </div>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto pt-14 md:pt-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">
              {activeTab === 'students' && 'Manajemen Data Siswa'}
              {activeTab === 'classes' && 'Manajemen Kelas'}
              {activeTab === 'assignments' && 'Manajemen Tugas Kelas'}
            </h2>
            <p className="text-sm text-slate-400">Kelola data pengguna, nilai, dan mata kuliah secara real-time ke Supabase. Tenant terisolasi.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={loadData} className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition" title="Refresh Data">
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {activeTab === 'students' && (
              <button onClick={() => setIsAddStudentOpen(true)} className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl shadow-lg shadow-indigo-600/20 transition">
                <Plus className="w-5 h-5" /> Tambah Siswa
              </button>
            )}
            {activeTab === 'classes' && (
              <button onClick={() => setIsAddClassOpen(true)} className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl shadow-lg shadow-indigo-600/20 transition">
                <Plus className="w-5 h-5" /> Tambah Kelas
              </button>
            )}
          </div>
        </div>

        {activeTab === 'students' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex flex-col md:flex-row gap-4 justify-between mb-6">
              <div className="relative flex-1">
                <Search className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
                <input type="text" placeholder="Cari berdasarkan nama atau NIM..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadData()} className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-11 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950/60 text-slate-400 uppercase text-xs">
                  <tr>
                    <th className="p-4 rounded-l-xl">Siswa</th>
                    <th className="p-4">NIM</th>
                    <th className="p-4">Kelas</th>
                    <th className="p-4">Kehadiran</th>
                    <th className="p-4">Rata-rata Nilai</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 rounded-r-xl text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {students.map((std) => (
                    <tr key={std.id} className="hover:bg-slate-700/30 transition">
                      <td className="p-4 flex items-center gap-3">
                        <img src={std.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${std.name}`} alt={std.name} className="w-10 h-10 rounded-full bg-slate-700" />
                        <div>
                          <div className="font-semibold text-white">{std.name}</div>
                          <div className="text-xs text-slate-400">{std.last_active || 'Aktif'}</div>
                        </div>
                      </td>
                      <td className="p-4 font-mono text-slate-400">{std.nim}</td>
                      <td className="p-4"><span className="px-2.5 py-1 bg-indigo-500/10 text-indigo-400 rounded-lg text-xs font-semibold">{std.class_name}</span></td>
                      <td className="p-4 font-semibold text-emerald-400">{std.attendance_rate ?? '—'}</td>
                      <td className="p-4 font-semibold text-amber-400">{std.average_score ?? '—'}</td>
                      <td className="p-4"><span className={`px-2.5 py-1 rounded-full text-xs font-bold ${std.status === 'Excelled' ? 'bg-emerald-500/10 text-emerald-400' : std.status === 'Good' ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-700 text-slate-300'}`}>{std.status || '—'}</span></td>
                      <td className="p-4 text-center">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => { setScoreForm({ ...scoreForm, student_id: std.id }); setIsAddScoreOpen(true); }} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300" title="Input Nilai Mata Kuliah">
                            <Award className="w-4 h-4 text-amber-400" />
                          </button>
                          <button onClick={() => setPendingDeleteStudentId(std.id)} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg" title="Hapus Siswa">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {students.length === 0 && !loading && (
                    <tr><td colSpan={7} className="text-center p-8 text-slate-500">Tidak ada data siswa ditemukan. Tambah siswa dengan form kosong (tanpa nilai default).</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'classes' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {classes.map((c) => (
              <div key={c.id} className="bg-slate-800 border border-slate-700 p-6 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <span className="px-3 py-1 bg-indigo-600/20 text-indigo-400 font-bold text-sm rounded-lg">{c.name}</span>
                    <button onClick={() => setPendingDeleteClassId(c.id)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <p className="text-slate-400 text-sm">{c.description || 'Tidak ada deskripsi.'}</p>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-700 flex justify-between items-center text-xs text-slate-400">
                  <span>Status: Aktif</span>
                  <span>Supabase • tenant scoped</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'assignments' && (
          <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl">
            <h3 className="font-bold text-lg text-white mb-4">Daftar Tugas Aktif</h3>
            <div className="space-y-4">
              {assignments.map((asg, idx) => (
                <div key={idx} className="p-4 bg-slate-900 border border-slate-700 rounded-xl flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">{asg.title}</div>
                    <div className="text-xs text-slate-400">Kelas: {asg.class_name}</div>
                  </div>
                  <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-semibold">{asg.status || 'Active'}</span>
                </div>
              ))}
              {assignments.length === 0 && <p className="text-slate-500 text-sm">Belum ada tugas dibuat.</p>}
            </div>
          </div>
        )}
      </main>

      {isAddStudentOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg text-white">Tambah Siswa Baru</h3>
              <button onClick={() => setIsAddStudentOpen(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateStudent} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nama Lengkap</label>
                <input type="text" required value={newStudent.name} onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white" placeholder="Nama siswa" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">NIM / NISN</label>
                <input type="text" required value={newStudent.nim} onChange={(e) => setNewStudent({ ...newStudent, nim: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white" placeholder="Kosongkan nilai lain" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Kelas</label>
                <select value={newStudent.class_name} onChange={(e) => setNewStudent({ ...newStudent, class_name: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white">
                  <option value="KA-101">KA-101</option>
                  <option value="KA-102">KA-102</option>
                  <option value="KA-103">KA-103</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Kehadiran % (opsional)</label>
                  <input type="number" min="0" max="100" value={newStudent.attendance_rate} onChange={(e) => setNewStudent({ ...newStudent, attendance_rate: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white" placeholder="—" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Nilai rata-rata (opsional)</label>
                  <input type="number" min="0" max="100" value={newStudent.average_score} onChange={(e) => setNewStudent({ ...newStudent, average_score: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white" placeholder="—" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Status (opsional)</label>
                <input type="text" value={newStudent.status} onChange={(e) => setNewStudent({ ...newStudent, status: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white" placeholder="Kosong = tanpa status" />
              </div>
              <p className="text-[11px] text-slate-500">Form tanpa nilai default 85. Kehadiran & nilai diisi nanti via Penilaian.</p>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsAddStudentOpen(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Batal</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold">Simpan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAddClassOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg text-white">Tambah Kelas Baru</h3>
              <button onClick={() => setIsAddClassOpen(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateClass} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nama Kelas (e.g. KA-104)</label>
                <input type="text" required value={newClass.name} onChange={(e) => setNewClass({ ...newClass, name: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Deskripsi</label>
                <textarea value={newClass.description} onChange={(e) => setNewClass({ ...newClass, description: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white" rows={3} />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsAddClassOpen(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Batal</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold">Simpan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAddScoreOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg text-white">Input Nilai Mata Kuliah</h3>
              <button onClick={() => setIsAddScoreOpen(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveScore} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Mata Kuliah</label>
                <select value={scoreForm.subject_name} onChange={(e) => setScoreForm({ ...scoreForm, subject_name: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white">
                  <option value="Pemrograman Web">Pemrograman Web</option>
                  <option value="Algoritma & Struktur Data">Algoritma & Struktur Data</option>
                  <option value="Basis Data">Basis Data</option>
                  <option value="Matematika Diskrit">Matematika Diskrit</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nilai (0 - 100)</label>
                <input type="number" min="0" max="100" required value={scoreForm.score as any} onChange={(e) => setScoreForm({ ...scoreForm, score: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white" placeholder="—" />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsAddScoreOpen(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Batal</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold">Simpan Nilai</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <AlertDialog open={!!pendingDeleteStudentId} onOpenChange={(open) => { if (!open) setPendingDeleteStudentId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus siswa?</AlertDialogTitle>
            <AlertDialogDescription>Tindakan ini tidak dapat dibatalkan. Data nilai terkait tetap untuk audit.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteStudent} className="bg-red-600 hover:bg-red-500">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingDeleteClassId} onOpenChange={(open) => { if (!open) setPendingDeleteClassId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus kelas?</AlertDialogTitle>
            <AlertDialogDescription>Kelas akan dihapus untuk tenant ini. Pastikan tidak ada siswa aktif di kelas tersebut.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteClass} className="bg-red-600 hover:bg-red-500">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
