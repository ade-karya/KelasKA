import { NextResponse } from 'next/server';
import { getAccessCodes, createAccessCode } from '@/lib/admin/access-code-store';

export async function GET() {
  try {
    const codes = await getAccessCodes();
    // Reverse sort by createdAt
    return NextResponse.json(codes.sort((a, b) => b.createdAt - a.createdAt));
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch access codes' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { code, maxUses, expiresAt } = await request.json();
    if (!code) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 });
    }
    
    const newCode = await createAccessCode(code, maxUses, expiresAt);
    return NextResponse.json(newCode);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create access code' }, { status: 400 });
  }
}
