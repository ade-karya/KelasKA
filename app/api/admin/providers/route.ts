import { NextResponse } from 'next/server';
import { getProviderConfig, saveProviderConfig } from '@/lib/admin/provider-config-store';

export async function GET() {
  try {
    const config = await getProviderConfig();
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const config = await request.json();
    await saveProviderConfig(config);
    return NextResponse.json({ success: true, config });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
