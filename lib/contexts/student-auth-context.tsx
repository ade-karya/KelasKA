"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { StudentProfile } from "@/lib/auth/student-session";

const STORAGE_KEY = "kelaska.studentSession";

interface StudentSession {
  token: string;
  student: StudentProfile;
}

interface StudentAuthContextType {
  student: StudentProfile | null;
  loading: boolean;
  login: (nisn: string, password: string) => Promise<{ error: Error | null }>;
  logout: () => void;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ error: Error | null }>;
  token: string | null;
}

const StudentAuthContext = createContext<StudentAuthContextType>({
  student: null,
  loading: true,
  login: async () => ({ error: null }),
  logout: () => {},
  changePassword: async () => ({ error: null }),
  token: null,
});

function readStoredSession(): StudentSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudentSession;
    if (!parsed?.token || !parsed?.student?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getStudentSessionToken(): string | null {
  return readStoredSession()?.token ?? null;
}

export function getStudentSession(): StudentSession | null {
  return readStoredSession();
}

export const StudentAuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<StudentSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSession(readStoredSession());
    setLoading(false);
  }, []);

  const persistSession = useCallback((next: StudentSession | null) => {
    if (next) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setSession(next);
  }, []);

  const login = useCallback(
    async (nisn: string, password: string) => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nisn, password }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          return { error: new Error(data.error || "Gagal masuk") };
        }
        persistSession({ token: data.token, student: data.student });
        return { error: null };
      } catch (err: unknown) {
        return { error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    [persistSession],
  );

  const logout = useCallback(() => {
    persistSession(null);
  }, [persistSession]);

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      const token = readStoredSession()?.token;
      if (!token) return { error: new Error("Silakan masuk terlebih dahulu") };
      try {
        const res = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ oldPassword, newPassword }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          return { error: new Error(data.error || "Gagal mengubah kata sandi") };
        }
        return { error: null };
      } catch (err: unknown) {
        return { error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    [],
  );

  return (
    <StudentAuthContext.Provider
      value={{
        student: session?.student ?? null,
        loading,
        login,
        logout,
        changePassword,
        token: session?.token ?? null,
      }}
    >
      {children}
    </StudentAuthContext.Provider>
  );
};

export const useStudentAuth = () => useContext(StudentAuthContext);