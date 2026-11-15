/**
 * Account authentication: configuration shared by the Node routes, the page
 * guards and the Edge proxy.
 *
 * The deployment gets a real account layer — students, teachers and admins —
 * instead of the anonymous-owner cookie, when `AUTH_ENABLED` is on. Each
 * signed-in account is its own owner (`user:<id>`), so every course, chat,
 * upload and setting stays per person while the role decides which home the
 * account lands on: a student keeps the classic learning home, a teacher gets
 * the workspace, and an admin gets the user console (with the workspace one
 * click away).
 *
 * Signing in is Google-only: `/api/auth/google/start` sends the browser to
 * Google, and the callback creates a *pending* account for a new address. An
 * admin approves it (and picks its role) from `/admin`; the account then signs
 * in normally. AUTH_ADMIN_EMAILS lists the Google addresses that are created
 * as active admins on their first sign-in, which is what breaks the
 * chicken-and-egg of the first approval.
 *
 * This module must stay Edge-safe: the proxy imports it. Node-only work (the
 * OAuth code exchange, database access) lives in `./google-oauth.ts`,
 * `./session.ts` and `@/lib/persistence/auth-accounts`.
 */

/** The three account roles. Anything else stored in the database is refused. */
export const AUTH_ROLES = ['student', 'teacher', 'admin'] as const;
export type AuthRole = (typeof AUTH_ROLES)[number];

/** The cookie holding the signed session token. */
export const AUTH_COOKIE = 'kelaska_session';

/** The short-lived cookie binding a Google OAuth callback to its request. */
export const AUTH_OAUTH_STATE_COOKIE = 'kelaska_oauth_state';
/** How long a sign-in attempt may take between leaving for Google and returning. */
export const AUTH_OAUTH_STATE_MAX_AGE_SECONDS = 600;

/** Longest e-mail accepted; RFC 5321's path limit is 254. */
export const AUTH_EMAIL_MAX_LENGTH = 254;
/** Longest display name accepted. */
export const AUTH_NAME_MAX_LENGTH = 80;

/**
 * Session lifetime. A session is a signed cookie plus a database row, so both
 * must agree: the cookie carries the expiry the row was written with.
 */
const SESSION_DAYS_DEFAULT = 30;
const SESSION_DAYS_MIN = 1;
const SESSION_DAYS_MAX = 365;

/**
 * A variable that reads as on: `true` or `1`. Unset and anything else are off,
 * matching the rest of the feature flags.
 */
function readBoolean(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/**
 * Whether the account layer is on. Off by default so an upstream deployment
 * (and the test suite) keeps the anonymous-owner behaviour; the Colab/Kaggle
 * installer writes `AUTH_ENABLED=true`.
 */
export function authEnabled(): boolean {
  return readBoolean(process.env.AUTH_ENABLED);
}

/**
 * The key the session cookie is signed with: `AUTH_SECRET`, else the instance
 * secret (`OPENMAIC_SECRET_KEY`, which the installer already creates and keeps
 * with the database), else the access code. `undefined` means a deployment
 * turned authentication on without any secret, which the boot refuses.
 */
export function authSecret(): string | undefined {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) return explicit;
  const instance = process.env.OPENMAIC_SECRET_KEY?.trim();
  if (instance) return instance;
  const accessCode = process.env.ACCESS_CODE?.trim();
  return accessCode || undefined;
}

/** Session lifetime in seconds, bounded so a typo cannot mint an eternal cookie. */
export function authSessionMaxAgeSeconds(): number {
  const raw = process.env.AUTH_SESSION_DAYS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const days = Number.isFinite(parsed) ? parsed : SESSION_DAYS_DEFAULT;
  const bounded = Math.min(SESSION_DAYS_MAX, Math.max(SESSION_DAYS_MIN, days));
  return bounded * 24 * 60 * 60;
}

/** Whether a value is one of the account roles. */
export function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === 'string' && (AUTH_ROLES as readonly string[]).includes(value);
}

/** A short label key for a role, for the account menus. */
export function authRoleLabelKey(role: AuthRole): string {
  switch (role) {
    case 'admin':
      return 'auth.roleAdmin';
    case 'teacher':
      return 'auth.roleTeacher';
    default:
      return 'auth.roleStudent';
  }
}

/**
 * Where an account lands after signing in: the classic home for students, the
 * workspace for teachers (when the workbench is part of this build) and the
 * user console for admins, who can open the workspace from there.
 *
 * `workbench` is passed by the caller, which can read the feature flags; this
 * module stays free of them so the Edge proxy and client code can import it.
 */
export function roleHomePath(role: AuthRole, workbench: boolean): string {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return workbench ? '/workspace' : '/';
  return '/';
}

/* -------------------------------------------------------------------------- */
/* Google sign-in                                                              */
/* -------------------------------------------------------------------------- */

export interface GoogleOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * The Google OAuth client, when the deployment has one. `AUTH_GOOGLE_*` wins
 * over the generic `GOOGLE_*` names (the same client is often already present
 * for other Google APIs). With nothing configured, `/login` shows a note and
 * the start route refuses instead of sending the browser to a broken consent
 * screen.
 */
export function googleOAuthCredentials(): GoogleOAuthCredentials | null {
  const clientId = (process.env.AUTH_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID)?.trim();
  const clientSecret = (
    process.env.AUTH_GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET
  )?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function googleOAuthConfigured(): boolean {
  return googleOAuthCredentials() !== null;
}

/**
 * The externally visible base URL, used to build the OAuth redirect URI (and
 * anything else that must match what the browser sees). Behind a proxy such as
 * Colab's, the request origin is not reachable by Google, so the operator sets
 * `AUTH_PUBLIC_URL`; without it the request origin is used, which is right for
 * a plain deployment on one hostname.
 */
export function authPublicBaseUrl(): string | undefined {
  const configured = process.env.AUTH_PUBLIC_URL?.trim();
  return configured ? configured.replace(/\/+$/, '') : undefined;
}

/**
 * The Google addresses that are made active admins on their first sign-in.
 * `AUTH_ADMIN_EMAILS` (comma-separated) wins over the single
 * `AUTH_ADMIN_EMAIL`; both are normalized to lower case. This replaces the
 * password-seeded admin of earlier drafts: with Google-only sign-in there is
 * no password to seed, so the first admin must be named in the environment and
 * then appears with an ordinary Google sign-in.
 */
export function authAdminEmails(): string[] {
  const raw = process.env.AUTH_ADMIN_EMAILS?.trim() || process.env.AUTH_ADMIN_EMAIL?.trim() || '';
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const email = entry.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

export function isAuthAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && authAdminEmails().includes(normalized);
}
