"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { logUserActivity } from "@/lib/supabase/activity-logger";

interface SupabaseAuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithEmail: (email: string, pass: string) => Promise<{ error: Error | null }>;
  signUpWithEmail: (email: string, pass: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextType>({
  user: null,
  session: null,
  loading: true,
  signInWithEmail: async () => ({ error: null }),
  signUpWithEmail: async () => ({ error: null }),
  signInWithGoogle: async () => ({ error: null }),
  signOut: async () => {},
});

export const SupabaseAuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (err) {
      console.warn("Supabase env missing or not initialized yet:", err);
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen to Auth State Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setLoading(false);

      if (event === "SIGNED_IN" && currentSession?.user) {
        await logUserActivity({
          userId: currentSession.user.id,
          userEmail: currentSession.user.email,
          action: "USER_LOGIN",
          details: { provider: currentSession.user.app_metadata.provider || "email" },
        });
      } else if (event === "SIGNED_OUT") {
        await logUserActivity({
          action: "USER_LOGOUT",
          details: { timestamp: new Date().toISOString() },
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = async (email: string, pass: string) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: pass,
      });

      if (!error && data.user) {
        await logUserActivity({
          userId: data.user.id,
          userEmail: data.user.email,
          action: "EMAIL_LOGIN_SUCCESS",
          details: { email },
        });
      } else if (error) {
        await logUserActivity({
          userEmail: email,
          action: "EMAIL_LOGIN_FAILED",
          details: { error: error.message },
        });
      }
      return { error };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { error };
    }
  };

  const signUpWithEmail = async (email: string, pass: string) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.signUp({
        email,
        password: pass,
      });

      if (!error && data.user) {
        await logUserActivity({
          userId: data.user.id,
          userEmail: data.user.email,
          action: "USER_REGISTER_SUCCESS",
          details: { email },
        });
      }
      return { error };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { error };
    }
  };

  const signInWithGoogle = async () => {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: typeof window !== "undefined" ? `${window.location.origin}/admin` : undefined,
        },
      });
      return { error };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { error };
    }
  };

  const signOut = async () => {
    try {
      const currentUser = user;
      const supabase = getSupabase();
      await supabase.auth.signOut();
      if (currentUser) {
        await logUserActivity({
          userId: currentUser.id,
          userEmail: currentUser.email,
          action: "USER_LOGOUT",
          details: { email: currentUser.email },
        });
      }
    } catch (error) {
      console.error("Error signing out from Supabase:", error);
    }
  };

  return (
    <SupabaseAuthContext.Provider
      value={{
        user,
        session,
        loading,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </SupabaseAuthContext.Provider>
  );
};

export const useSupabaseAuth = () => useContext(SupabaseAuthContext);
