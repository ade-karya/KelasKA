import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getAuthenticatedStudent, extractBearerToken } from '@/lib/auth/student-session';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('students-api');
const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

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
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

  // Enterprise guard — Vercel+Supabase: wajib auth (siswa JWT atau guru Supabase)
  let tenantId: string | null = null;
  let allowedClasses: string[] | null = null;
  let isGuru = false;
  try {
    const studentAuth: any = await getAuthenticatedStudent(request as any);
    if (studentAuth?.student) {
      tenantId = studentAuth.student.tenant_id ?? DEFAULT_TENANT;
      // siswa hanya boleh lihat kelasnya sendiri? Untuk students list, siswa tidak boleh list semua — batasi ke kelasnya
      // Tapi untuk MVP, izinkan siswa lihat kelasnya saja
      allowedClasses = studentAuth.student.class_name ? [studentAuth.student.class_name] : null;
    } else {
      const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim() || extractBearerToken(request as any);
      if (bearer) {
        try {
          const { data: { user } } = await supabaseServer.auth.getUser(bearer);
          if (user) {
            const { data: profile } = await supabaseServer.from('profiles').select('tenant_id, role, class_names').eq('id', user.id).maybeSingle();
            if (profile && ['teacher','admin'].includes((profile as any).role)) {
              isGuru = true;
              tenantId = (profile as any).tenant_id;
              allowedClasses = (profile as any).class_names ?? [];
              // admin boleh semua kelas di tenant, teacher terbatas
              if ((profile as any).role === 'admin') allowedClasses = null;
            } else if (profile) {
              return apiError('UNAUTHENTICATED', 403, 'Role tidak diizinkan');
            } else {
              // guru tanpa profile → single-tenant fallback
              isGuru = true;
              tenantId = DEFAULT_TENANT;
            }
          }
        } catch {}
      }
      if (!tenantId) {
        if (isProduction) {
          return apiError('UNAUTHENTICATED', 401, 'Auth diperlukan');
        }
        // dev preview: izinkan tanpa auth, pakai default tenant
        tenantId = DEFAULT_TENANT;
        log.warn('students-api: unauthenticated preview (dev only)');
      }
    }
  } catch (e) {
    log.warn('students-api auth check failed', e);
    if (isProduction) return apiError('UNAUTHENTICATED', 401, 'Auth diperlukan');
    tenantId = DEFAULT_TENANT;
  }

  // Guru non-admin hanya boleh lihat kelas ampu — enforce di query
  if (isGuru && allowedClasses && allowedClasses.length > 0) {
    if (className && className !== 'Semua Kelas' && !allowedClasses.includes(className)) {
      return NextResponse.json({ success: true, data: { metrics: { totalStudents: 0, avgClassScore: 0, avgAttendance: 0, activeAssignments: 0 }, availableClasses: allowedClasses, students: [] } });
    }
  }

  try {
    let dbQuery: any = supabaseServer.from('students').select(`
      id,
      name,
      nim,
      class_name,
      attendance_rate,
      average_score,
      avatar_url,
      status,
      last_active,
      tenant_id,
      student_scores (
        subject_name,
        score
      ),
      teacher_notes (
        note
      )
    `);

    if (tenantId) dbQuery = dbQuery.eq('tenant_id', tenantId);
    if (allowedClasses && allowedClasses.length > 0) {
      // jika query className spesifik sudah difilter di atas, ini untuk list all
      if (!className || className === 'Semua Kelas') dbQuery = dbQuery.in('class_name', allowedClasses);
    }

    if (className && className !== 'Semua Kelas') {
      dbQuery = dbQuery.eq('class_name', className);
    }

    if (query) {
      dbQuery = dbQuery.or(`name.ilike.%${query}%,nim.ilike.%${query}%`);
    }

    const { data: studentsData, error } = await dbQuery;

    if (error || !studentsData || studentsData.length === 0) {
      if (isProduction) {
        // prod: jangan fallback ke mock (anti bocor lintas tenant)
        if (error) log.warn('students query failed', error);
        return NextResponse.json({ success: true, data: { metrics: { totalStudents: 0, avgClassScore: 0, avgAttendance: 0, activeAssignments: 0 }, availableClasses: allowedClasses && allowedClasses.length ? ['Semua Kelas', ...allowedClasses] : ['Semua Kelas', 'KA-101', 'KA-102', 'KA-103'], students: [] } });
      }
      console.warn('Supabase query fallback to mock:', error?.message);
      return returnMockFiltered(className, query, tenantId, allowedClasses);
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

    // Fetch classes — tenant-scoped
    let classQuery: any = supabaseServer.from('classes').select('name, tenant_id');
    if (tenantId) classQuery = classQuery.eq('tenant_id', tenantId);
    if (allowedClasses && allowedClasses.length > 0) classQuery = classQuery.in('name', allowedClasses);
    const { data: classesData } = await classQuery;
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
        availableClasses: availableClasses.length > 1 ? availableClasses : (allowedClasses && allowedClasses.length ? ['Semua Kelas', ...allowedClasses] : ['Semua Kelas', 'KA-101', 'KA-102', 'KA-103']),
        students: formattedStudents,
      },
    });
  } catch (err) {
    console.error('API Error, using mock fallback:', err);
    const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
    if (isProd) return NextResponse.json({ success: true, data: { metrics: { totalStudents: 0, avgClassScore: 0, avgAttendance: 0, activeAssignments: 0 }, availableClasses: ['Semua Kelas', 'KA-101', 'KA-102', 'KA-103'], students: [] } });
    return returnMockFiltered(className, query, null, null);
  }
}

function returnMockFiltered(className: string | null, query: string | undefined, _tenantId: string | null = null, allowedClassesParam: string[] | null = null) {
  let filteredStudents = [...MOCK_STUDENTS];
  // enterprise: guru hanya lihat kelas ampu di mock juga
  if (allowedClassesParam && allowedClassesParam.length > 0) {
    filteredStudents = filteredStudents.filter((s) => allowedClassesParam.includes(s.className));
  }

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
      availableClasses: allowedClassesParam && allowedClassesParam.length ? ['Semua Kelas', ...allowedClassesParam] : ['Semua Kelas', 'KA-101', 'KA-102', 'KA-103'],
      students: filteredStudents,
    },
  });
}
