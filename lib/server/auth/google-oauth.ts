/**
 * Google OpenID Connect: the only way into an account.
 *
 * The flow is the standard authorization-code one with a signed `state`
 * cookie, so a callback that did not come from this browser's start route is
 * refused before any code is exchanged. The profile's `sub` is the identity
 * that is bound to the account row; the e-mail is what an admin approves by,
 * but a later e-mail change on the Google account cannot take over another
 * person's pending or approved row because the bound `sub` is checked first.
 *
 * Node-only: it needs the client secret and makes the two outbound requests.
 * The Edge proxy never imports this module.
 */
import { normalizeAuthEmail } from '@/lib/persistence/auth-accounts';
import { googleOAuthCredentials, type GoogleOAuthCredentials } from './config';

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const REQUEST_TIMEOUT_MS = 10_000;
/** Only what the sign-in needs: an address, a name and a stable subject. */
const SCOPES = ['openid', 'email', 'profile'];

export class GoogleOAuthError extends Error {
  constructor(
    readonly code:
      | 'not-configured'
      | 'token-exchange-failed'
      | 'profile-unavailable'
      | 'email-unverified',
    message: string,
  ) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

/** The redirect URI Google must be told about, derived from the public base URL. */
export function googleRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/auth/google/callback`;
}

/** The consent screen URL for one sign-in attempt. */
export function buildGoogleAuthorizationUrl(options: {
  readonly credentials: GoogleOAuthCredentials;
  readonly redirectUri: string;
  readonly state: string;
  readonly loginHint?: string;
}): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', options.credentials.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', options.state);
  // Let the person choose which Google account to use, instead of silently
  // reusing the one already active in the browser (shared school devices).
  url.searchParams.set('prompt', 'select_account');
  if (options.loginHint) url.searchParams.set('login_hint', options.loginHint);
  return url.toString();
}

interface TokenResponse {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/** Exchange the callback's one-time code for an access token. */
export async function exchangeGoogleAuthorizationCode(options: {
  readonly credentials: GoogleOAuthCredentials;
  readonly redirectUri: string;
  readonly code: string;
}): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      client_id: options.credentials.clientId,
      client_secret: options.credentials.clientSecret,
      redirect_uri: options.redirectUri,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || typeof body.access_token !== 'string' || body.access_token.length === 0) {
    const detail =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.error === 'string'
          ? body.error
          : `HTTP ${response.status}`;
    throw new GoogleOAuthError('token-exchange-failed', `Google token exchange failed: ${detail}`);
  }
  return body.access_token;
}

export interface GoogleProfile {
  /** Google's stable account id. Bind this, never the e-mail alone. */
  readonly subject: string;
  readonly email: string;
  readonly name: string;
}

interface UserInfoResponse {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

/** Read the signed-in Google profile, refusing an unverified address. */
export async function fetchGoogleUserProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new GoogleOAuthError(
      'profile-unavailable',
      `Google profile request failed with HTTP ${response.status}`,
    );
  }
  const body = (await response.json().catch(() => ({}))) as UserInfoResponse;
  if (typeof body.sub !== 'string' || body.sub.length === 0) {
    throw new GoogleOAuthError('profile-unavailable', 'Google profile has no subject');
  }
  if (typeof body.email !== 'string' || body.email.length === 0) {
    throw new GoogleOAuthError('profile-unavailable', 'Google profile has no e-mail');
  }
  // An unverified address could be another person's; never approve or bind by it.
  if (body.email_verified !== true) {
    throw new GoogleOAuthError('email-unverified', 'the Google e-mail is not verified');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  return {
    subject: body.sub,
    email: normalizeAuthEmail(body.email),
    name: name || normalizeAuthEmail(body.email).split('@')[0]!,
  };
}

/** The credentials, or a typed refusal for a deployment without a client. */
export function requireGoogleOAuthCredentials(): GoogleOAuthCredentials {
  const credentials = googleOAuthCredentials();
  if (!credentials) {
    throw new GoogleOAuthError(
      'not-configured',
      'Google sign-in is not configured: set AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET',
    );
  }
  return credentials;
}
