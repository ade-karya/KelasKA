/**
 * Safe localStorage wrapper for Zustand persist middleware.
 *
 * In some environments (Edge InPrivate, cross-origin iframes, restricted
 * security policies), even *reading* `window.localStorage` throws a
 * SecurityError. This wrapper catches all errors and falls back to an
 * in-memory store so the app can still function without persistence.
 */

import type { StateStorage } from 'zustand/middleware';

/** Test whether localStorage is accessible (may throw SecurityError). */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__zustand_storage_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/** In-memory fallback when localStorage is blocked. */
const memoryStore = new Map<string, string>();

/**
 * A StateStorage implementation that tries localStorage first, and
 * silently falls back to an in-memory Map if access is denied.
 */
export const safeStorage: StateStorage = {
  getItem(name: string): string | null {
    try {
      if (typeof window !== 'undefined' && isLocalStorageAvailable()) {
        return localStorage.getItem(name);
      }
    } catch {
      // SecurityError or other — fall through to memory store
    }
    return memoryStore.get(name) ?? null;
  },

  setItem(name: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && isLocalStorageAvailable()) {
        localStorage.setItem(name, value);
        return;
      }
    } catch {
      // SecurityError — fall through to memory store
    }
    memoryStore.set(name, value);
  },

  removeItem(name: string): void {
    try {
      if (typeof window !== 'undefined' && isLocalStorageAvailable()) {
        localStorage.removeItem(name);
        return;
      }
    } catch {
      // SecurityError — fall through to memory store
    }
    memoryStore.delete(name);
  },
};
