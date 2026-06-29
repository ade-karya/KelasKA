import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getAccessCodes } from '@/lib/admin/access-code-store';

export async function GET() {
  try {
    const codes = await getAccessCodes();
    
    const stats = {
      uptimeSeconds: process.uptime(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      totalAccessCodes: codes.length,
      activeAccessCodes: codes.filter(c => c.isActive).length,
    };
    
    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
