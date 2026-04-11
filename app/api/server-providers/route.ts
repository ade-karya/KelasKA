import {
  getServerProviders,
  getServerTTSProviders,
  getServerASRProviders,
  getServerPDFProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerWebSearchProviders,
} from '@/lib/server/provider-config';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { getPinTokenFromRequest, getPinUserServicesPublic, getPinUserDefaultLanguage } from '@/lib/server/pin-auth';
import { NextRequest } from 'next/server';

const log = createLogger('ServerProviders');

export async function GET(req: NextRequest) {
  try {
    const pinToken = getPinTokenFromRequest(req) || undefined;
    const pinServices = pinToken ? getPinUserServicesPublic(pinToken) : null;
    const pinDefaultLanguage = pinToken ? getPinUserDefaultLanguage(pinToken) : undefined;

    return apiSuccess({
      providers: getServerProviders(),
      tts: getServerTTSProviders(),
      asr: getServerASRProviders(),
      pdf: getServerPDFProviders(),
      image: getServerImageProviders(),
      video: getServerVideoProviders(),
      webSearch: getServerWebSearchProviders(),
      ...(pinServices ? {
        pinUser: pinServices,
        ...(pinDefaultLanguage ? { pinDefaultLanguage } : {}),
      } : {}),
    });
  } catch (error) {
    log.error('Error fetching server providers:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
