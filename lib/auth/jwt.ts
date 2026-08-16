import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export interface StudentTokenPayload {
  sub: string;
  nisn: string;
  role: 'student';
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('AUTH_JWT_SECRET env var is not set (min 16 chars)');
  }
  return new TextEncoder().encode(secret);
}

export async function signStudentToken(payload: StudentTokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role, nisn: payload.nisn })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getJwtSecret());
}

export async function verifyStudentToken(
  token: string,
): Promise<(JWTPayload & StudentTokenPayload) | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.role !== 'student' || typeof payload.sub !== 'string') return null;
    return payload as JWTPayload & StudentTokenPayload;
  } catch {
    return null;
  }
}