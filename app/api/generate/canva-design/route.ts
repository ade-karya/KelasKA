import { NextResponse } from 'next/server';
import { CanvaClient } from '@/lib/canva/client';
import { createLogger } from '@/lib/logger';
import { AutofillData } from '@/lib/canva/types';

const log = createLogger('API:generate:canva-design');

export async function POST(req: Request) {
  try {
    const { title, data } = await req.json() as { title?: string, data?: AutofillData };

    const token = req.headers.get('x-canva-token') || process.env.CANVA_TOKEN;
    const baseUrl = req.headers.get('x-canva-base-url') || process.env.CANVA_BASE_URL;
    const templateId = req.headers.get('x-canva-template-id') || process.env.CANVA_TEMPLATE_ID;
    const format = (req.headers.get('x-canva-export-format') || 'png') as 'png' | 'jpg';

    if (!token) {
      return NextResponse.json({ success: false, message: 'Missing Canva API token' }, { status: 401 });
    }

    if (!templateId) {
      return NextResponse.json({ success: false, message: 'Missing Canva Brand Template ID' }, { status: 400 });
    }

    if (!data || Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, message: 'Missing Autofill data parameters' }, { status: 400 });
    }

    const client = new CanvaClient({
      token,
      baseUrl: baseUrl || undefined,
      brandTemplateId: templateId,
      exportFormat: format,
    });

    log.info(`Generating autofill design for template ${templateId}`);

    const exportUrls = await client.generateDesignImage(
      title || 'Autofilled Design from KelasKA', 
      data
    );

    if (exportUrls && exportUrls.length > 0) {
      return NextResponse.json({ 
        success: true, 
        originalImageUrls: exportUrls, 
      });
    }

    return NextResponse.json({ success: false, message: 'No URLs returned from Export Job' }, { status: 500 });
  } catch (error: any) {
    log.error('Generate Canva Design route error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
