import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

const MOCK_STUDENTS = [
  {
    id: 'std-1',
    name: 'Aditya Pratama',
    nim: '2024001',
    className: 'KA-101',
    attendanceRate: 96,
    averageScore: 92.5,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aditya',
    status: 'Excelled',
    subjects: [
      { name: 'Pemrograman Web', score: 95 },
      { name: 'Algoritma & Struktur Data', score: 90 },
      { name: 'Basis Data', score: 94 },
      { name: 'Matematika Diskrit', score: 91 },
    ],
    lastActive: '2 jam yang lalu',
    teacherNotes: 'Sangat aktif di kelas dan memiliki pemahaman logika pemrograman yang kuat.',
  },
  {
    id: 'std-2',
    name: 'Budi Santoso',
    nim: '2024002',
    className: 'KA-101',
    attendanceRate: 88,
    averageScore: 84.0,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Budi',
    status: 'Good',
    subjects: [
      { name: 'Pemrograman Web', score: 82 },
      { name: 'Algoritma & Struktur Data', score: 85 },
      { name: 'Basis Data', score: 88 },
      { name: 'Matematika Diskrit', score: 81 },
    ],
    lastActive: '5 jam yang lalu',
    teacherNotes: 'Konsisten dan selalu mengumpulkan tugas tepat waktu.',
  },
  {
    id: 'std-3',
    name: 'Citra Dewi',
    nim: '2024003',
    className: 'KA-101',
    attendanceRate: 98,
    averageScore: 94.8,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Citra',
    status: 'Excelled',
    subjects: [
      { name: 'Pemrograman Web', score: 98 },
      { name: 'Algoritma & Struktur Data', score: 96 },
      { name: 'Basis Data', score: 92 },
      { name: 'Matematika Diskrit', score: 93 },
    ],
    lastActive: '10 menit yang lalu',
    teacherNotes: 'Juara kelas. Penjelasan tugas sangat terstruktur.',
  },
  {
    id: 'std-4',
    name: 'Deni Kurniawan',
    nim: '2024004',
    className: 'KA-102',
    attendanceRate: 74,
    averageScore: 68.5,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Deni',
    status: 'Needs Attention',
    subjects: [
      { name: 'Pemrograman Web', score: 65 },
      { name: 'Algoritma & Struktur Data', score: 70 },
      { name: 'Basis Data', score: 72 },
      { name: 'Matematika Diskrit', score: 67 },
    ],
    lastActive: '1 hari yang lalu',
    teacherNotes: 'Perlu bimbingan tambahan pada materi Algoritma.',
  },
  {
    id: 'std-5',
    name: 'Eka Rahmawati',
    nim: '2024005',
    className: 'KA-102',
    attendanceRate: 91,
    averageScore: 86.2,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Eka',
    status: 'Good',
    subjects: [
      { name: 'Pemrograman Web', score: 88 },
      { name: 'Algoritma & Struktur Data', score: 84 },
      { name: 'Basis Data', score: 87 },
      { name: 'Matematika Diskrit', score: 86 },
    ],
    lastActive: '3 jam yang lalu',
    teacherNotes: 'Partisipasi baik dan hasil diskusi kelompok memuaskan.',
  },
  {
    id: 'std-6',
    name: 'Fajar Nugraha',
    nim: '2024006',
    className: 'KA-103',
    attendanceRate: 82,
    averageScore: 78.0,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Fajar',
    status: 'Good',
    subjects: [
      { name: 'Pemrograman Web', score: 76 },
      { name: 'Algoritma & Struktur Data', score: 80 },
      { name: 'Basis Data', score: 78 },
      { name: 'Matematika Diskrit', score: 78 },
    ],
    lastActive: '12 jam yang lalu',
    teacherNotes: 'Tingkatkan kehadiran di sesi lab.',
  },
  {
    id: 'std-7',
    name: 'Gita Puspita',
    nim: '2024007',
    className: 'KA-103',
    attendanceRate: 90,
    averageScore: 88.5,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Gita',
    status: 'Good',
    subjects: [
      { name: 'Pemrograman Web', score: 90 },
      { name: 'Algoritma & Struktur Data', score: 88 },
      { name: 'Basis Data', score: 89 },
      { name: 'Matematika Diskrit', score: 87 },
    ],
    lastActive: 'Baru saja',
    teacherNotes: 'Proaktif bertanya dan hasil praktikum sangat baik.',
  },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const className = searchParams.get('className');
  const query = searchParams.get('query')?.toLowerCase();

  try {
    let dbQuery = supabaseServer.from('students').select(`
      id,
      name,
      nim,
      class_name,
      attendance_rate,
      average_score,
      avatar_url,
      status,
      last_active,
      student_scores (
        subject_name,
        score
      ),
      teacher_notes (
        note
      )
    `);

    if (className && className !== 'Semua Kelas') {
      dbQuery = dbQuery.eq('class_name', className);
    }

    if (query) {
      dbQuery = dbQuery.or(`name.ilike.%${query}%,nim.ilike.%${query}%`);
    }

    const { data: studentsData, error } = await dbQuery;

    if (error || !studentsData || studentsData.length === 0) {
      console.warn('Supabase query fallback to mock:', error?.message);
      return returnMockFiltered(className, query);
    }

    // Format Supabase data to fit expected StudentPerformance API response format
    const formattedStudents = studentsData.map((s: any) => ({
      id: s.id,
      name: s.name,
      nim: s.nim,
      className: s.class_name,
      attendanceRate: Number(s.attendance_rate || 0),
      averageScore: Number(s.average_score || 0),
      avatarUrl: s.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${s.name}`,
      status: s.status || 'Good',
      subjects: (s.student_scores || []).map((sc: any) => ({
        name: sc.subject_name,
        score: Number(sc.score || 0),
      })),
      lastActive: s.last_active || 'Baru saja',
      teacherNotes: s.teacher_notes?.[0]?.note || 'Belum ada catatan.',
    }));

    // Fetch classes
    const { data: classesData } = await supabaseServer.from('classes').select('name');
    const availableClasses = ['Semua Kelas', ...(classesData || []).map((c: any) => c.name)];

    const totalStudents = formattedStudents.length;
    const avgClassScore =
      totalStudents > 0
        ? Number((formattedStudents.reduce((acc: number, s: any) => acc + s.averageScore, 0) / totalStudents).toFixed(1))
        : 0;

    const avgAttendance =
      totalStudents > 0
        ? Number((formattedStudents.reduce((acc: number, s: any) => acc + s.attendanceRate, 0) / totalStudents).toFixed(1))
        : 0;

    return NextResponse.json({
      success: true,
      data: {
        metrics: {
          totalStudents,
          avgClassScore,
          avgAttendance,
          activeAssignments: 4,
        },
        availableClasses: availableClasses.length > 1 ? availableClasses : ['Semua Kelas', 'KA-101', 'KA-102', 'KA-103'],
        students: formattedStudents,
      },
    });
  } catch (err) {
    console.error('API Error, using mock fallback:', err);
    return returnMockFiltered(className, query);
  }
}

function returnMockFiltered(className: string | null, query: string | undefined) {
  let filteredStudents = [...MOCK_STUDENTS];

  if (className && className !== 'Semua Kelas') {
    filteredStudents = filteredStudents.filter(
      (s) => s.className.toLowerCase() === className.toLowerCase()
    );
  }

  if (query) {
    filteredStudents = filteredStudents.filter(
      (s) => s.name.toLowerCase().includes(query) || s.nim.toLowerCase().includes(query)
    );
  }

  const totalStudents = filteredStudents.length;
  const avgClassScore =
    totalStudents > 0
      ? Number((filteredStudents.reduce((acc, s) => acc + s.averageScore, 0) / totalStudents).toFixed(1))
      : 0;

  const avgAttendance =
    totalStudents > 0
      ? Number((filteredStudents.reduce((acc, s) => acc + s.attendanceRate, 0) / totalStudents).toFixed(1))
      : 0;

  return NextResponse.json({
    success: true,
    data: {
      metrics: {
        totalStudents,
        avgClassScore,
        avgAttendance,
        activeAssignments: 4,
      },
      availableClasses: ['Semua Kelas', 'KA-101', 'KA-102', 'KA-103'],
      students: filteredStudents,
    },
  });
}
