import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface AccessCode {
  id: string;
  code: string;
  createdAt: number;
  expiresAt: number | null; // Unix timestamp or null for never
  usageCount: number;
  maxUses: number | null; // null for unlimited
  isActive: boolean;
}

const DATA_FILE = path.join(process.cwd(), 'data', 'access-codes.json');

async function ensureDataFile(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    try {
      await fs.access(DATA_FILE);
    } catch {
      await fs.writeFile(DATA_FILE, JSON.stringify([]), 'utf-8');
    }
  } catch (err) {
    console.error('Failed to ensure access-codes.json:', err);
  }
}

export async function getAccessCodes(): Promise<AccessCode[]> {
  await ensureDataFile();
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data) as AccessCode[];
  } catch (err) {
    console.error('Error reading access codes:', err);
    return [];
  }
}

export async function saveAccessCodes(codes: AccessCode[]): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(codes, null, 2), 'utf-8');
}

export async function createAccessCode(code: string, maxUses: number | null = null, expiresAt: number | null = null): Promise<AccessCode> {
  const codes = await getAccessCodes();
  
  if (codes.find(c => c.code === code)) {
    throw new Error('Access code already exists');
  }

  const newCode: AccessCode = {
    id: crypto.randomUUID(),
    code,
    createdAt: Date.now(),
    expiresAt,
    usageCount: 0,
    maxUses,
    isActive: true,
  };

  codes.push(newCode);
  await saveAccessCodes(codes);
  return newCode;
}

export async function updateAccessCode(id: string, updates: Partial<Pick<AccessCode, 'isActive' | 'maxUses' | 'expiresAt' | 'code'>>): Promise<AccessCode | null> {
  const codes = await getAccessCodes();
  const index = codes.findIndex(c => c.id === id);
  
  if (index === -1) return null;

  codes[index] = { ...codes[index], ...updates };
  await saveAccessCodes(codes);
  
  return codes[index];
}

export async function deleteAccessCode(id: string): Promise<boolean> {
  const codes = await getAccessCodes();
  const filtered = codes.filter(c => c.id !== id);
  
  if (filtered.length === codes.length) return false;

  await saveAccessCodes(filtered);
  return true;
}

export async function incrementAccessCodeUsage(code: string): Promise<boolean> {
  const codes = await getAccessCodes();
  const target = codes.find(c => c.code === code);
  
  if (!target) return false;
  if (!target.isActive) return false;
  if (target.expiresAt !== null && Date.now() > target.expiresAt) return false;
  if (target.maxUses !== null && target.usageCount >= target.maxUses) return false;

  target.usageCount += 1;
  await saveAccessCodes(codes);
  return true;
}

/**
 * Checks if a given code is valid (exists, active, not expired, usage limit not exceeded)
 */
export async function isValidAccessCode(code: string): Promise<boolean> {
  // Always allow the environment ACCESS_CODE as a fallback
  if (process.env.ACCESS_CODE === code) {
    return true;
  }
  
  const codes = await getAccessCodes();
  const target = codes.find(c => c.code === code);
  
  if (!target) return false;
  if (!target.isActive) return false;
  if (target.expiresAt !== null && Date.now() > target.expiresAt) return false;
  if (target.maxUses !== null && target.usageCount >= target.maxUses) return false;
  
  return true;
}
