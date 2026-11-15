/**
 * Input checks shared by the account routes.
 *
 * Every rule returns a value already normalized for storage, or `undefined` so
 * the route can answer one generic "invalid request" instead of echoing the
 * input back. They are deliberately plain functions: no framework, no
 * database, so the same checks run before a write and in tests.
 */
import { AUTH_EMAIL_MAX_LENGTH, AUTH_NAME_MAX_LENGTH } from './config';

/** One `@`, a dot in the domain, no whitespace. Good enough to reject typos, not to prove delivery. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = normalizeEmail(value);
  if (email.length === 0 || email.length > AUTH_EMAIL_MAX_LENGTH) return undefined;
  return EMAIL_PATTERN.test(email) ? email : undefined;
}

export function validName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > AUTH_NAME_MAX_LENGTH) return undefined;
  return name;
}
