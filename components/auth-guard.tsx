'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const router = useRouter();
  const pathname = usePathname();
  const [storeHydrated, setStoreHydrated] = useState(false);

  useEffect(() => {
    setStoreHydrated(true);
  }, []);

  useEffect(() => {
    if (storeHydrated && !isLoggedIn && pathname !== '/login') {
      router.replace('/login');
    }
  }, [storeHydrated, isLoggedIn, pathname, router]);

  // Wait for hydration before rendering anything to prevent flash
  if (!storeHydrated) return null;

  // Render children if logged in or if we are already on the login page
  if (!isLoggedIn && pathname !== '/login') return null;

  return <>{children}</>;
}
