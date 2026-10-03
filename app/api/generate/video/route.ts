/**
 * Video Generation API
 *
 * Generates a video from a text prompt using the specified provider.
 * Uses async task pattern (submit → poll) so maxDuration is set to 5 minutes.
 *
 * POST /api/generate/video
 *
 * The provider comes from the video slot of the model configuration. The
 * headers below are deprecated and count only while the slot is unassigned:
 *   x-video-provider, x-video-model, x-api-key, x-base-url
 *
 * Body: { prompt, duration?, aspectRatio?, resolution?, sourceImageUrl?, drivingVideoUrl?, relativeMotion?, doCrop?, pasteBack? }
 * Response: { success: boolean, result?: VideoGenerationResult, error?: string }
 *
 * Image-to-video providers (e.g. Hugging Face LivePortrait) animate
 * `sourceImageUrl` — an https: or data: URL of a previously generated image —
 * instead of dreaming motion from the prompt alone.
 */

import { NextRequest } from 'next/server';
import { recordGenerationUsage } from '@/lib/server/usage-storage';
import { generateVideo, normalizeVideoOptions, VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import {
  isServerConfiguredProvider,
  isServerProviderDisabled,
  resolveVideoApiKey,
  resolveVideoBaseUrl,
  resolveVideoModel,
} from '@/lib/server/provider-config';
import type { VideoProviderId, VideoGenerationOptions } from '@/lib/media/types';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateClientBaseUrl } from '@/lib/server/ssrf-guard';
import { withVideoProviderFetch } from '@/lib/server/media-provider-fetch';
import { isZeroGpuQuotaMessage } from '@/lib/media/media-failure';
import {
  mediaResolutionResponse,
  RequestedProviderRefusedError,
  resolveMediaSlot,
  type MediaConnection,
} from '@/lib/server/model-config/media';
import { requestWorkspaceId } from '@/lib/server/model-config/runtime';

const log = createLogger('VideoGeneration API');

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // Hoisted for the catch block so failures before resolution (bad headers,
  // SSRF refusal) still produce a safe message without a ReferenceError —
  // mirror the image route contract.
  let providerId: VideoProviderId | undefined;
  let model: string | undefined;
  try {
    const body = (await request.json()) as VideoGenerationOptions;

    if (!body.prompt) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing prompt');
    }

    // The video slot decides; the provider a request names (x-video-provider
    // with its key and base URL, deprecated) counts only when it is unassigned.
    let connection: MediaConnection;
    try {
      connection = await resolveMediaSlot('video', {
        workspaceId: await requestWorkspaceId(request),
        legacyRequest: () => requestedVideoProvider(request),
      });
    } catch (error) {
      const refused = mediaResolutionResponse(error, 'Video generation');
      if (refused) return refused;
      throw error;
    }
    const connProviderId = connection.providerId as VideoProviderId;
    providerId = connProviderId;
    const { apiKey, baseUrl, managed } = connection;
    if (!apiKey) {
      return apiError(
        'MISSING_API_KEY',
        401,
        `No API key configured for video provider: ${providerId}`,
      );
    }
    // A configured slot without a model uses the provider's first catalogue
    // model. On the legacy default provider the request's model still applies
    // through its allowlist, as before slots.
    model =
      connection.origin === 'configuration'
        ? (connection.modelId ?? VIDEO_PROVIDERS[connProviderId]?.models?.[0]?.id)
        : connection.origin === 'default'
          ? resolveVideoModel(
              connProviderId,
              request.headers.get('x-video-model')?.trim() || undefined,
            )
          : connection.modelId;
    if (!model) {
      return apiError(
        'MISSING_MODEL',
        400,
        `No model configured for video provider: ${providerId}`,
      );
    }

    // Normalize options against provider capabilities
    const options = normalizeVideoOptions(providerId, body);

    log.info(
      `Generating video: provider=${providerId}, model=${model || 'default'}, ` +
        `prompt="${body.prompt.slice(0, 80)}...", duration=${options.duration ?? 'auto'}, ` +
        `aspect=${options.aspectRatio ?? 'auto'}, resolution=${options.resolution ?? 'auto'}`,
    );

    const result = await generateVideo(
      withVideoProviderFetch({ providerId, apiKey, baseUrl, model }, managed),
      options,
    );

    log.info(
      `Video generated: url=${result.url ? 'yes' : 'no'}, ${result.width}x${result.height}, ${result.duration}s`,
    );

    void recordGenerationUsage({
      kind: 'video',
      unit: 'second',
      providerId,
      modelId: model,
      quantity: result.duration,
    });

    return apiSuccess({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The provider's error text is logged only; the caller gets a fixed,
    // categorized message (no upstream body) so the UI can act on it —
    // mirror the image route contract.
    // Detect content safety filter rejections (e.g. Seedance SensitiveContent errors)
    if (message.includes('SensitiveContent') || message.includes('sensitive information')) {
      log.warn(`Video blocked by content safety filter: ${message}`);
      return apiError(
        'CONTENT_SENSITIVE',
        400,
        'The video provider rejected this prompt under its content safety policy',
      );
    }
    const upstreamStatus = message.match(/\((\d{3})\)/)?.[1];
    // Provider + model context is safe to expose (no key, no upstream body)
    // and tells the user exactly which selection failed. May be undefined
    // when the failure happened before resolution.
    const where = `(${providerId ?? 'unknown provider'} / ${model || 'default model'})`;
    // Hugging Face ZeroGPU refusals have no (NNN) status: `success:false`
    // with `output.error` (e.g. "You have exceeded your ZeroGPU runs
    // limit..."). Surface a retryable 429 with the free-tier daily limit
    // instead of a generic 500. Free tier: ~5 GPU-min/day + ~3 runs/day,
    // reset 24h after first GPU use; one image-to-video clip costs 2 runs
    // (source still + animation), so the free tier fits roughly 1 video/day.
    // Other providers' quota/busy messages take the generic branch below —
    // the free-tier numbers are Hugging Face-specific, so they stay behind
    // the ZeroGPU match rather than on the shared helper.
    if (/zerogpu|exceeded.{0,20}runs/i.test(message)) {
      log.warn(`Video generation quota refusal: ${message}`);
      return apiError(
        'UPSTREAM_ERROR',
        429,
        `The video provider reports exhausted GPU quota ${where}. Hugging Face free tier allows ~5 GPU-min and ~3 runs/day (1 video costs 2 runs: source image + animation); quota resets 24h after first use. Wait for the reset or use a paid Hugging Face plan, then Retry.`,
      );
    }
    if (isZeroGpuQuotaMessage(message)) {
      log.warn(`Video generation quota/busy refusal: ${message}`);
      return apiError(
        'UPSTREAM_ERROR',
        429,
        `The video provider reports exhausted quota or a busy queue ${where} (429). Wait a moment and Retry; if it keeps failing, the daily free quota may be exhausted (quota resets 24h after first use).`,
      );
    }
    switch (upstreamStatus) {
      case '401':
      case '403':
        log.warn(`Video generation unauthorized: ${message}`);
        return apiError(
          'INVALID_REQUEST',
          401,
          `The video provider rejected the API key ${where} (401/403). Check the key for this provider.`,
        );
      case '402':
        log.warn(`Video generation payment required: ${message}`);
        return apiError(
          'UPSTREAM_ERROR',
          402,
          `The video provider reports insufficient credits or exhausted quota ${where} (402). Check the account, or wait for the daily free reset.`,
        );
      case '404':
        log.warn(`Video generation unknown model: ${message}`);
        return apiError(
          'INVALID_REQUEST',
          400,
          `The video provider does not recognize this model ${where}. Re-fetch the model list and pick a current id.`,
        );
      case '400':
        log.warn(`Video generation bad request: ${message}`);
        return apiError(
          'INVALID_REQUEST',
          400,
          `The video provider rejected the request parameters for this model ${where} (400). Try another model.`,
        );
      case '429':
        log.warn(`Video generation rate-limited: ${message}`);
        return apiError(
          'UPSTREAM_ERROR',
          429,
          `The video provider is rate-limiting requests ${where} (429). Wait a moment and retry.`,
        );
      default:
        break;
    }
    log.error(`Video generation failed: ${message}`, error);
    return apiError('INTERNAL_ERROR', 500, `Video generation failed ${where}`);
  }
}

/**
 * The provider the request names with x-video-provider (deprecated), with the
 * key, base URL and model headers, or undefined when it names none.
 */
async function requestedVideoProvider(request: NextRequest): Promise<MediaConnection | undefined> {
  const providerId = request.headers.get('x-video-provider')?.trim() as VideoProviderId | undefined;
  if (!providerId) return undefined;
  // A force-disabled provider is off for everyone (#665).
  if (isServerProviderDisabled('video', providerId)) {
    throw new RequestedProviderRefusedError(
      apiError('PROVIDER_DISABLED', 403, 'This video provider is disabled by the server'),
    );
  }
  // Managed providers are admin-owned: ignore any client-sent key/baseUrl.
  const managed = isServerConfiguredProvider('video', providerId);
  const clientApiKey = managed ? undefined : request.headers.get('x-api-key') || undefined;
  const clientBaseUrl = managed ? undefined : request.headers.get('x-base-url') || undefined;
  if (clientBaseUrl) {
    const ssrfError = await validateClientBaseUrl(clientBaseUrl);
    if (ssrfError) throw new RequestedProviderRefusedError(apiError('INVALID_URL', 403, ssrfError));
  }
  // A managed provider may pin its model list server-side
  // (VIDEO_<PREFIX>_MODELS): an allowlisted client choice wins, otherwise the
  // first pinned entry is the managed default.
  const model = resolveVideoModel(
    providerId,
    request.headers.get('x-video-model')?.trim() || undefined,
  );
  return {
    providerId,
    apiKey: resolveVideoApiKey(providerId, clientApiKey),
    ...(model ? { modelId: model } : {}),
    baseUrl: resolveVideoBaseUrl(providerId, clientBaseUrl),
    managed,
    userEndpoint: Boolean(clientBaseUrl),
    origin: 'request',
  };
}
