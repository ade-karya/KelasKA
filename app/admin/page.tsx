'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  School,
  BookOpen,
  Plus,
  Trash2,
  Edit,
  Save,
  X,
  Search,
  RefreshCw,
  Award,
  CheckCircle,
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
  addTeacherNote,
  getAssignments,
  createAssignment,
} from '@/lib/supabase/admin-queries';

export default function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState<'students' | 'classes' | 'assignments'>('students');
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState('Semua Kelas');

  // Modal States
  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [isAddClassOpen, setIsAddClassOpen] = useState(false);
  const [isAddScoreOpen, setIsAddScoreOpen] = useState(false);

  // Form States
  const [newStudent, setNewStudent] = useState({
    name: '',
    nim: '',
    class_name: 'KA-101',
    attendance_rate: 100,
    average_score: 85,
    status: 'Good',
  });
  const [newClass, setNewClass] = useState({ name: '', description: '' });
  const [scoreForm, setScoreForm] = useState({
    student_id: '',
    subject_name: 'Pemrograman Web',
    score: 85,
  });

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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedClassFilter]);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createStudent({
        ...newStudent,
        avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${newStudent.name}`,
      });
      setIsAddStudentOpen(false);
      setNewStudent({
        name: '',
        nim: '',
        class_name: 'KA-101',
        attendance_rate: 100,
        average_score: 85,
        status: 'Good',
      });
      loadData();
    } catch (e: any) {
      alert('Gagal menambah siswa: ' + e.message);
    }
  };

  const handleDeleteStudent = async (id: string) => {
    if (!confirm('Yakin ingin menghapus siswa ini?')) return;
    try {
      await deleteStudent(id);
      loadData();
    } catch (e: any) {
      alert('Gagal menghapus siswa: ' + e.message);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createClass(newClass.name, newClass.description);
      setIsAddClassOpen(false);
      setNewClass({ name: '', description: '' });
      loadData();
    } catch (e: any) {
      alert('Gagal menambah kelas: ' + e.message);
    }
  };

  const handleSaveScore = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addOrUpdateScore(scoreForm.student_id, scoreForm.subject_name, Number(scoreForm.score));
      setIsAddScoreOpen(false);
      loadData();
    } catch (e: any) {
      alert('Gagal menyimpan nilai: ' + e.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-800 border-r border-slate-700 p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-indigo-600 rounded-xl">
              <School className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-white">KelasKA Admin</h1>
              <p className="text-xs text-slate-400">Management System</p>
            </div>
          </div>

          <nav className="space-y-2">
            <button
              onClick={() => setActiveTab('students')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'students'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <Users className="w-5 h-5" />
              Kelola Siswa
            </button>

            <button
              onClick={() => setActiveTab('classes')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'classes'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <School className="w-5 h-5" />
              Kelola Kelas
            </button>

            <button
              onClick={() => setActiveTab('assignments')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'assignments'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <FileText className="w-5 h-5" />
              Kelola Tugas
            </button>
          </nav>
        </div>

        <div className="border-t border-slate-700 pt-4">
          <a
            href="/"
            className="flex items-center gap-2 text-xs text-indigo-400 hover:underline"
          >
            ← Kembali ke Dashboard Utama
          </a>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">
              {activeTab === 'students' && 'Manajemen Data Siswa'}
              {activeTab === 'classes' && 'Manajemen Kelas'}
              {activeTab === 'assignments' && 'Manajemen Tugas Kelas'}
            </h2>
            <p className="text-sm text-slate-400">
              Kelola data pengguna, nilai, dan mata kuliah secara real-time ke Supabase.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={loadData}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition"
              title="Refresh Data"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {activeTab === 'students' && (
              <button
                onClick={() => setIsAddStudentOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl shadow-lg shadow-indigo-600/20 transition"
              >
                <Plus className="w-5 h-5" />
                Tambah Siswa
              </button>
            )}

            {activeTab === 'classes' && (
              <button
                onClick={() => setIsAddClassOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl shadow-lg shadow-indigo-600/20 transition"
              >
                <Plus className="w-5 h-5" />
                Tambah Kelas
              </button>
            )}
          </div>
        </div>

        {/* Tab 1: Students Table */}
        {activeTab === 'students' && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-xl">
            {/* Filter Bar */}
            <div className="flex flex-col md:flex-row gap-4 justify-between mb-6">
              <div className="relative flex-1">
                <Search className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari berdasarkan nama atau NIM..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadData()}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-11 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Students Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-900/60 text-slate-400 uppercase text-xs">
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
                        <img
                          src={std.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${std.name}`}
                          alt={std.name}
                          className="w-10 h-10 rounded-full bg-slate-700"
                        />
                        <div>
                          <div className="font-semibold text-white">{std.name}</div>
                          <div className="text-xs text-slate-400">{std.last_active || 'Aktif'}</div>
                        </div>
                      </td>
                      <td className="p-4 font-mono text-slate-400">{std.nim}</td>
                      <td className="p-4">
                        <span className="px-2.5 py-1 bg-indigo-500/10 text-indigo-400 rounded-lg text-xs font-semibold">
                          {std.class_name}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-emerald-400">{std.attendance_rate}%</td>
                      <td className="p-4 font-semibold text-amber-400">{std.average_score}</td>
                      <td className="p-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            std.status === 'Excelled'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : std.status === 'Good'
                              ? 'bg-blue-500/10 text-blue-400'
                              : 'bg-amber-500/10 text-amber-400'
                          }`}
                        >
                          {std.status}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={() => {
                              setScoreForm({ ...scoreForm, student_id: std.id });
                              setIsAddScoreOpen(true);
                            }}
                            className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300"
                            title="Input Nilai Mata Kuliah"
                          >
                            <Award className="w-4 h-4 text-amber-400" />
                          </button>
                          <button
                            onClick={() => handleDeleteStudent(std.id)}
                            className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg"
                            title="Hapus Siswa"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {students.length === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-slate-500">
                        Tidak ada data siswa ditemukan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Classes */}
        {activeTab === 'classes' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {classes.map((c) => (
              <div key={c.id} className="bg-slate-800 border border-slate-700 p-6 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <span className="px-3 py-1 bg-indigo-600/20 text-indigo-400 font-bold text-sm rounded-lg">
                      {c.name}
                    </span>
                    <button
                      onClick={async () => {
                        if (confirm(`Hapus kelas ${c.name}?`)) {
                          await deleteClass(c.id);
                          loadData();
                        }
                      }}
                      className="text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-slate-400 text-sm">{c.description || 'Tidak ada deskripsi.'}</p>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-700 flex justify-between items-center text-xs text-slate-400">
                  <span>Status: Aktif</span>
                  <span>Supabase Table</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 3: Assignments */}
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
                  <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-semibold">
                    {asg.status || 'Active'}
                  </span>
                </div>
              ))}
              {assignments.length === 0 && (
                <p className="text-slate-500 text-sm">Belum ada tugas dibuat.</p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Modal Add Student */}
      {isAddStudentOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg text-white">Tambah Siswa Baru</h3>
              <button onClick={() => setIsAddStudentOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateStudent} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={newStudent.name}
                  onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">NIM</label>
                <input
                  type="text"
                  required
                  value={newStudent.nim}
                  onChange={(e) => setNewStudent({ ...newStudent, nim: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Kelas</label>
                <select
                  value={newStudent.class_name}
                  onChange={(e) => setNewStudent({ ...newStudent, class_name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white"
                >
                  <option value="KA-101">KA-101</option>
                  <option value="KA-102">KA-102</option>
                  <option value="KA-103">KA-103</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAddStudentOpen(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold"
                >
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Add Class */}
      {isAddClassOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg text-white">Tambah Kelas Baru</h3>
              <button onClick={() => setIsAddClassOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateClass} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nama Kelas (e.g. KA-104)</label>
                <input
                  type="text"
                  required
                  value={newClass.name}
                  onChange={(e) => setNewClass({ ...newClass, name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Deskripsi</label>
                <textarea
                  value={newClass.description}
                  onChange={(e) => setNewClass({ ...newClass, description: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAddClassOpen(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold"
                >
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Score Form */}
      {isAddScoreOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg text-white">Input Nilai Mata Kuliah</h3>
              <button onClick={() => setIsAddScoreOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveScore} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Mata Kuliah</label>
                <select
                  value={scoreForm.subject_name}
                  onChange={(e) => setScoreForm({ ...scoreForm, subject_name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white"
                >
                  <option value="Pemrograman Web">Pemrograman Web</option>
                  <option value="Algoritma & Struktur Data">Algoritma & Struktur Data</option>
                  <option value="Basis Data">Basis Data</option>
                  <option value="Matematika Diskrit">Matematika Diskrit</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nilai (0 - 100)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  required
                  value={scoreForm.score}
                  onChange={(e) => setScoreForm({ ...scoreForm, score: Number(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAddScoreOpen(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold"
                >
                  Simpan Nilai
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
