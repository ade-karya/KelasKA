-- SQL Migration Script for Supabase Schema setup for KelasKA & kelas_ka
-- Run this script in your Supabase Project SQL Editor

-- 1. Create Classes Table
CREATE TABLE IF NOT EXISTS public.classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create Subjects Table
CREATE TABLE IF NOT EXISTS public.subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create Students Table
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    nim VARCHAR(20) NOT NULL UNIQUE,
    nisn VARCHAR(20) UNIQUE,
    password_hash TEXT,
    class_name VARCHAR(50) NOT NULL,
    attendance_rate NUMERIC(5, 2) DEFAULT 100.00,
    average_score NUMERIC(5, 2) DEFAULT 0.00,
    avatar_url TEXT,
    status VARCHAR(30) DEFAULT 'Good',
    last_active VARCHAR(50) DEFAULT 'Baru saja',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create Student Scores Table
CREATE TABLE IF NOT EXISTS public.student_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    subject_name VARCHAR(100) NOT NULL,
    score NUMERIC(5, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Create Attendance Table
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_present BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Create Assignments Table
CREATE TABLE IF NOT EXISTS public.assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    class_name VARCHAR(50) NOT NULL,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(30) DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Create Teacher Notes Table
CREATE TABLE IF NOT EXISTS public.teacher_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS & Public Access Policies for REST API / Flutter
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read classes" ON public.classes FOR SELECT USING (true);
CREATE POLICY "Allow public all classes" ON public.classes FOR ALL USING (true);

CREATE POLICY "Allow public read subjects" ON public.subjects FOR SELECT USING (true);
CREATE POLICY "Allow public all subjects" ON public.subjects FOR ALL USING (true);

CREATE POLICY "Allow public read students" ON public.students FOR SELECT USING (true);
CREATE POLICY "Allow public all students" ON public.students FOR ALL USING (true);

CREATE POLICY "Allow public read student_scores" ON public.student_scores FOR SELECT USING (true);
CREATE POLICY "Allow public all student_scores" ON public.student_scores FOR ALL USING (true);

CREATE POLICY "Allow public read attendance" ON public.attendance FOR SELECT USING (true);
CREATE POLICY "Allow public all attendance" ON public.attendance FOR ALL USING (true);

CREATE POLICY "Allow public read assignments" ON public.assignments FOR SELECT USING (true);
CREATE POLICY "Allow public all assignments" ON public.assignments FOR ALL USING (true);

CREATE POLICY "Allow public read teacher_notes" ON public.teacher_notes FOR SELECT USING (true);
CREATE POLICY "Allow public all teacher_notes" ON public.teacher_notes FOR ALL USING (true);

-- Insert Seed Data (Classes)
INSERT INTO public.classes (name, description) VALUES
('KA-101', 'Kelas Komputer Akuntansi 101'),
('KA-102', 'Kelas Komputer Akuntansi 102'),
('KA-103', 'Kelas Komputer Akuntansi 103')
ON CONFLICT (name) DO NOTHING;

-- Insert Seed Data (Students)
INSERT INTO public.students (id, name, nim, nisn, password_hash, class_name, attendance_rate, average_score, avatar_url, status, last_active) VALUES
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Aditya Pratama', '2024001', '0020240001', '$2b$10$IjdbeS/RYQ0.A/InKOtnZ.kZeY96BOg09iLLkS1q7QG0ukv7lrSfS', 'KA-101', 96.00, 92.50, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aditya', 'Excelled', '2 jam yang lalu'),
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Budi Santoso', '2024002', '0020240002', '$2b$10$IjdbeS/RYQ0.A/InKOtnZ.kZeY96BOg09iLLkS1q7QG0ukv7lrSfS', 'KA-101', 88.00, 84.00, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Budi', 'Good', '5 jam yang lalu'),
('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'Citra Dewi', '2024003', '0020240003', '$2b$10$IjdbeS/RYQ0.A/InKOtnZ.kZeY96BOg09iLLkS1q7QG0ukv7lrSfS', 'KA-101', 98.00, 94.80, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Citra', 'Excelled', '10 menit yang lalu'),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', 'Deni Kurniawan', '2024004', '0020240004', '$2b$10$IjdbeS/RYQ0.A/InKOtnZ.kZeY96BOg09iLLkS1q7QG0ukv7lrSfS', 'KA-102', 74.00, 68.50, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Deni', 'Needs Attention', '1 hari yang lalu'),
('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', 'Eka Rahmawati', '2024005', '0020240005', '$2b$10$IjdbeS/RYQ0.A/InKOtnZ.kZeY96BOg09iLLkS1q7QG0ukv7lrSfS', 'KA-102', 91.00, 86.20, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Eka', 'Good', '3 jam yang lalu'),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', 'Fajar Nugraha', '2024006', '0020240006', '$2b$10$IjdbeS/RYQ0.A/InKOtnZ.kZeY96BOg09iLLkS1q7QG0ukv7lrSfS', 'KA-103', 82.00, 78.00, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Fajar', 'Good', '12 jam yang lalu'),
('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', 'Gita Puspita', '2024007', '0020240007', '$2b$10$Q4vlo/ReB46MAVRO.7RieeKc6EXu5ycEl2QWaK.MacfqFoJ6QabuG', 'KA-103', 90.00, 88.50, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Gita', 'Good', 'Baru saja')
ON CONFLICT (nim) DO NOTHING;

-- Insert Student Scores
INSERT INTO public.student_scores (student_id, subject_name, score) VALUES
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Pemrograman Web', 95),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Algoritma & Struktur Data', 90),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Basis Data', 94),
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Matematika Diskrit', 91),

('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Pemrograman Web', 82),
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Algoritma & Struktur Data', 85),
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Basis Data', 88),
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Matematika Diskrit', 81),

('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'Pemrograman Web', 98),
('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'Algoritma & Struktur Data', 96),
('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'Basis Data', 92),
('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'Matematika Diskrit', 93),

('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', 'Pemrograman Web', 65),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', 'Algoritma & Struktur Data', 70),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', 'Basis Data', 72),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', 'Matematika Diskrit', 67),

('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', 'Pemrograman Web', 88),
('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', 'Algoritma & Struktur Data', 84),
('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', 'Basis Data', 87),
('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', 'Matematika Diskrit', 86),

('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', 'Pemrograman Web', 76),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', 'Algoritma & Struktur Data', 80),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', 'Basis Data', 78),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', 'Matematika Diskrit', 78),

('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', 'Pemrograman Web', 90),
('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', 'Algoritma & Struktur Data', 88),
('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', 'Basis Data', 89),
('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', 'Matematika Diskrit', 87);

-- Insert Teacher Notes
INSERT INTO public.teacher_notes (student_id, note) VALUES
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Sangat aktif di kelas dan memiliki pemahaman logika pemrograman yang kuat.'),
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'Konsisten dan selalu mengumpulkan tugas tepat waktu.'),
('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'Juara kelas. Penjelasan tugas sangat terstruktur.'),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', 'Perlu bimbingan tambahan pada materi Algoritma.'),
('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', 'Partisipasi baik dan hasil diskusi kelompok memuaskan.'),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', 'Tingkatkan kehadiran di sesi lab.'),
('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', 'Proaktif bertanya dan hasil praktikum sangat baik.');

-- 8. Create User Activity Logs Table
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    user_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Create Quiz Attempts Table (student quiz/test results)
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    stage_id TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL UNIQUE,
    class_name VARCHAR(50),
    subject_name TEXT,
    phase VARCHAR(20) NOT NULL DEFAULT 'submitted',
    retry_number INTEGER DEFAULT 0,
    total_points NUMERIC(10, 2) DEFAULT 0.00,
    earned_points NUMERIC(10, 2) DEFAULT 0.00,
    score NUMERIC(5, 2) DEFAULT 0.00,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. Create Quiz Attempt Answers Table (per-question details)
CREATE TABLE IF NOT EXISTS public.quiz_attempt_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    question_type VARCHAR(20),
    answer JSONB DEFAULT '{}'::jsonb,
    is_correct BOOLEAN,
    earned NUMERIC(10, 2) DEFAULT 0.00,
    points NUMERIC(10, 2) DEFAULT 0.00,
    ai_comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for quiz attempts
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student_created ON public.quiz_attempts (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_scene ON public.quiz_attempts (scene_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempt_answers_attempt ON public.quiz_attempt_answers (attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempt_answers_question ON public.quiz_attempt_answers (question_id);

-- Index for fast queries by user and created_at
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON public.user_activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_id ON public.user_activity_logs (user_id);

-- RLS & Policies for user_activity_logs
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read user_activity_logs" ON public.user_activity_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert user_activity_logs" ON public.user_activity_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public all user_activity_logs" ON public.user_activity_logs FOR ALL USING (true);

-- RLS & Policies for quiz_attempts
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read quiz_attempts" ON public.quiz_attempts FOR SELECT USING (true);
CREATE POLICY "Allow public all quiz_attempts" ON public.quiz_attempts FOR ALL USING (true);

-- RLS & Policies for quiz_attempt_answers
ALTER TABLE public.quiz_attempt_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read quiz_attempt_answers" ON public.quiz_attempt_answers FOR SELECT USING (true);
CREATE POLICY "Allow public all quiz_attempt_answers" ON public.quiz_attempt_answers FOR ALL USING (true);

