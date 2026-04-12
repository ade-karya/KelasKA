import { NextResponse } from 'next/server';
import { CanvaClient } from '@/lib/canva/client';
import { createLogger } from '@/lib/logger';

const log = createLogger('API:verify-canva');

export async function POST(req: Request) {
  try {
    const token = req.headers.get('x-canva-token') || process.env.CANVA_TOKEN;
    const baseUrl = req.headers.get('x-canva-base-url') || process.env.CANVA_BASE_URL;

    if (!token) {
      return NextResponse.json({ success: false, message: 'Missing Canva token' }, { status: 401 });
    }

    const client = new CanvaClient({
      token,
      baseUrl: baseUrl || undefined,
      brandTemplateId: '', // not needed for verify
    });

    const isConnected = await client.verifyConnection();

    if (isConnected) {
      return NextResponse.json({ success: true, message: 'Connected to Canva API successfully' });
    } else {
      return NextResponse.json({ success: false, message: 'Failed to verify connection to Canva API' }, { status: 400 });
    }
  } catch (error: any) {
    log.error('Verify Canva route error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
