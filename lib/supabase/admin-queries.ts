import { supabase } from './client';

export interface ClassItem {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
}

export interface StudentItem {
  id: string;
  name: string;
  nim: string;
  class_name: string;
  attendance_rate: number;
  average_score: number;
  avatar_url?: string;
  status: string;
  last_active?: string;
}

export interface ScoreItem {
  id?: string;
  student_id: string;
  subject_name: string;
  score: number;
}

export interface TeacherNoteItem {
  id?: string;
  student_id: string;
  note: string;
}

export interface AssignmentItem {
  id?: string;
  title: string;
  class_name: string;
  due_date: string;
  status: string;
}

// --- CLASSES CRUD ---
export async function getClasses() {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data as ClassItem[];
}

export async function createClass(className: string, description?: string) {
  const { data, error } = await supabase
    .from('classes')
    .insert([{ name: className, description }])
    .select();
  if (error) throw error;
  return data[0];
}

export async function deleteClass(id: string) {
  const { error } = await supabase.from('classes').delete().eq('id', id);
  if (error) throw error;
}

// --- STUDENTS CRUD ---
export async function getStudentsWithDetails(selectedClass?: string, searchQuery?: string) {
  let query = supabase
    .from('students')
    .select(`
      *,
      student_scores (id, subject_name, score),
      teacher_notes (id, note)
    `)
    .order('name', { ascending: true });

  if (selectedClass && selectedClass !== 'Semua Kelas') {
    query = query.eq('class_name', selectedClass);
  }

  if (searchQuery) {
    query = query.or(`name.ilike.%${searchQuery}%,nim.ilike.%${searchQuery}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createStudent(student: Omit<StudentItem, 'id'>) {
  const { data, error } = await supabase
    .from('students')
    .insert([student])
    .select();
  if (error) throw error;
  return data[0];
}

export async function updateStudent(id: string, updates: Partial<StudentItem>) {
  const { data, error } = await supabase
    .from('students')
    .update(updates)
    .eq('id', id)
    .select();
  if (error) throw error;
  return data[0];
}

export async function deleteStudent(id: string) {
  const { error } = await supabase.from('students').delete().eq('id', id);
  if (error) throw error;
}

// --- SCORES CRUD ---
export async function addOrUpdateScore(studentId: string, subjectName: string, score: number) {
  const { data: existing } = await supabase
    .from('student_scores')
    .select('id')
    .eq('student_id', studentId)
    .eq('subject_name', subjectName)
    .single();

  if (existing) {
    const { data, error } = await supabase
      .from('student_scores')
      .update({ score })
      .eq('id', existing.id)
      .select();
    if (error) throw error;
    return data[0];
  } else {
    const { data, error } = await supabase
      .from('student_scores')
      .insert([{ student_id: studentId, subject_name: subjectName, score }])
      .select();
    if (error) throw error;
    return data[0];
  }
}

// --- TEACHER NOTES ---
export async function addTeacherNote(studentId: string, note: string) {
  const { data, error } = await supabase
    .from('teacher_notes')
    .insert([{ student_id: studentId, note }])
    .select();
  if (error) throw error;
  return data[0];
}

// --- ASSIGNMENTS ---
export async function getAssignments() {
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .order('due_date', { ascending: true });
  if (error) throw error;
  return data as AssignmentItem[];
}

export async function createAssignment(assignment: Omit<AssignmentItem, 'id'>) {
  const { data, error } = await supabase
    .from('assignments')
    .insert([assignment])
    .select();
  if (error) throw error;
  return data[0];
}
