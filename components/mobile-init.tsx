'use client';

import { useEffect } from 'react';
import { initializePushNotifications } from '@/lib/mobile/push';

/**
 * MobileInitializer
 * - Registers the Service Worker for offline/PWA caching (all browsers)
 * - Initializes native Capacitor push notifications (Android/iOS wrapper only)
 */
export function MobileInitializer() {
  useEffect(() => {
    // Register Service Worker for PWA offline support
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[SW] Registered:', reg.scope);
        })
        .catch((err) => {
          console.warn('[SW] Registration failed:', err);
        });
    }

    // Initialize Capacitor push notifications (no-op on web)
    initializePushNotifications();
  }, []);

  return null;
}
