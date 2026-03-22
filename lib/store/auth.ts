import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthState {
  isLoggedIn: boolean;
  nisn: string | null;
  login: (nisn: string, pin: string) => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isLoggedIn: false,
      nisn: null,
      login: async (nisn: string, pin: string) => {
        // For demonstration, valid NISN is 10 digits and valid PIN is 6 digits.
        const isValid = /^\d{10}$/.test(nisn) && /^\d{6}$/.test(pin);
        if (isValid) {
          set({ isLoggedIn: true, nisn });
          // Set cookie for middleware redirect
          document.cookie = `auth_session=true; path=/; max-age=2592000`; // 30 days
          return true;
        }
        return false;
      },
      logout: () => {
        set({ isLoggedIn: false, nisn: null });
        // Delete cookie
        document.cookie = `auth_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);
