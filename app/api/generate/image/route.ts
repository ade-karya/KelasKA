/**
 * Image Generation API
 *
 * Generates an image from a text prompt using the specified provider.
 * Called by the client during media generation after slides are produced.
 *
 * POST /api/generate/image
 *
 * The provider comes from the image slot of the model configuration. The
 * headers below are deprecated and count only while the slot is unassigned:
 *   x-image-provider, x-image-model, x-api-key, x-base-url
 *
 * Body: { prompt, negativePrompt?, width?, height?, aspectRatio?, style?,
 *   seed?, randomizeSeed?, guidanceScale?, numInferenceSteps? }
 *   (the FLUX.1-dev `/infer` fields are Hugging Face FLUX only)
 * Response: { success: boolean, result?: ImageGenerationResult, error?: string }
 */

import { NextRequest } from 'next/server';
import { recordGenerationUsage } from '@/lib/server/usage-storage';
import { generateImage, IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import {
  isServerConfiguredProvider,
  isServerProviderDisabled,
  resolveImageApiKey,
  resolveImageBaseUrl,
  resolveImageModel,
} from '@/lib/server/provider-config';
import {
  adapterOptions,
  mediaResolutionResponse,
  RequestedProviderRefusedError,
  resolveMediaSlot,
  type MediaConnection,
} from '@/lib/server/model-config/media';
import { requestWorkspaceId } from '@/lib/server/model-config/runtime';
import type { ImageProviderId, ImageGenerationOptions } from '@/lib/media/types';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateClientBaseUrl } from '@/lib/server/ssrf-guard';
import { withMediaProviderFetch } from '@/lib/server/media-provider-fetch';
import { resolveImageSize } from '@/lib/server/image-sizing';

const log = createLogger('ImageGeneration API');

// The ComfyUI adapter polls up to GENERATION_TIMEOUT_MS (5 min) and real
// workflows can take 3–5 min. 60s would let platforms that enforce maxDuration
// (e.g. Vercel) kill the request ~4 min before the adapter finishes. 300s is
// the practical ceiling on most managed platforms and matches the poll budget.
// (Self-hosted Node servers ignore this value entirely.)
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // Hoisted for the catch block so failures before resolution (bad headers,
  // SSRF refusal) still produce a safe message without a ReferenceError.
  let providerId: ImageProviderId | undefined;
  let model: string | undefined;
  try {
    const body = (await request.json()) as ImageGenerationOptions;

    if (!body.prompt) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing prompt');
    }

    // The image slot decides; the provider a request names (x-image-provider
    // with its key and base URL, deprecated) counts only when it is unassigned.
    let connection: MediaConnection;
    try {
      connection = await resolveMediaSlot('image', {
        workspaceId: await requestWorkspaceId(request),
        legacyRequest: () => requestedImageProvider(request),
      });
    } catch (error) {
      const refused = mediaResolutionResponse(error, 'Image generation');
      if (refused) return refused;
      throw error;
    }
    const {
      providerId: connProviderId,
      apiKey,
      baseUrl,
      managed,
    } = connection as MediaConnection & {
      providerId: ImageProviderId;
    };
    providerId = connProviderId;
    const provider = IMAGE_PROVIDERS[connProviderId];
    if (provider?.requiresApiKey && !apiKey) {
      return apiError(
        'MISSING_API_KEY',
        401,
        `No API key configured for image provider: ${providerId}`,
      );
    }
    // A configured slot without a model uses the provider's first catalogue
    // model. On the legacy default provider the request's model still applies
    // through its allowlist, as before slots.
    model =
      connection.origin === 'configuration'
        ? (connection.modelId ?? provider?.models?.[0]?.id)
        : connection.origin === 'default'
          ? resolveImageModel(
              connProviderId,
              request.headers.get('x-image-model')?.trim() || undefined,
            )
          : connection.modelId;
    // Workflow-based providers (e.g. comfyui-image) have no model catalog and
    // need no model; everyone else must resolve one.
    if (!model && provider?.models && provider.models.length > 0) {
      return apiError(
        'MISSING_MODEL',
        400,
        `No model configured for image provider: ${providerId}`,
      );
    }

    // The provider's own options (openmaic.yml `options`, or the workspace
    // provider's) meet the request's the documented way: a configured
    // provider's win (FLUX `/infer` fields, …), otherwise the request's do.
    const sizedOptions = resolveImageSize(
      adapterOptions(connection, body as unknown as Record<string, unknown>) as unknown as ImageGenerationOptions,
      { providerId, modelId: model },
    );

    log.info(
      `Generating image: provider=${providerId}, model=${model || 'default'}, ` +
        `prompt="${sizedOptions.prompt.slice(0, 80)}...", size=${sizedOptions.width ?? 'auto'}x${sizedOptions.height ?? 'auto'}`,
    );

    const result = await generateImage(
      withMediaProviderFetch({ providerId, apiKey: apiKey ?? '', baseUrl, model }, managed),
      sizedOptions,
    );

    void recordGenerationUsage({
      kind: 'image',
      unit: 'image',
      providerId,
      modelId: model,
      quantity: 1,
    });

    return apiSuccess({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The provider's error text is logged only; the caller gets a fixed,
    // categorized message (no upstream body) so the UI can act on it.
    // Detect content safety filter rejections (e.g. Seedream OutputImageSensitiveContentDetected)
    if (message.includes('SensitiveContent') || message.includes('sensitive information')) {
      log.warn(`Image blocked by content safety filter: ${message}`);
      return apiError(
        'CONTENT_SENSITIVE',
        400,
        'The image provider rejected this prompt under its content safety policy',
      );
    }
    const upstreamStatus = message.match(/\((\d{3})\)/)?.[1];
    // Provider + model context is safe to expose (no key, no upstream body)
    // and tells the user exactly which selection failed. May be undefined
    // when the failure happened before resolution.
    const where = `(${providerId ?? 'unknown provider'} / ${model || 'default model'})`;
    // Hugging Face ZeroGPU queue refusals have no (NNN) status; surface the
    // provider's own message (e.g. "You have exceeded your ZeroGPU runs
    // limit...") as a retryable 429 instead of a generic 500.
    if (/zerogpu|quota/i.test(message)) {
      log.warn(`Image generation quota refusal: ${message}`);
      return apiError(
        'UPSTREAM_ERROR',
        429,
        `The image provider reports exhausted GPU quota ${where}. Wait for the daily quota reset or upgrade the Hugging Face plan.`,
      );
    }
    switch (upstreamStatus) {
      case '401':
      case '403':
        log.warn(`Image generation unauthorized: ${message}`);
        return apiError(
          'INVALID_REQUEST',
          401,
          `The image provider rejected the API key ${where} (401/403). Check the key for this provider.`,
        );
      case '402':
        log.warn(`Image generation payment required: ${message}`);
        return apiError(
          'UPSTREAM_ERROR',
          402,
          `The image provider reports insufficient credits or exhausted quota ${where} (402). Even $0 models need an OpenRouter key with remaining free quota — check the account, or wait for the daily free reset.`,
        );
      case '404':
        log.warn(`Image generation unknown model: ${message}`);
        return apiError(
          'INVALID_REQUEST',
          400,
          `The image provider does not recognize this model ${where}. Re-fetch the model list (Ambil model) and pick a current id.`,
        );
      case '400':
        log.warn(`Image generation bad request: ${message}`);
        return apiError(
          'INVALID_REQUEST',
          400,
          `The image provider rejected the request parameters for this model ${where} (400). Try another model.`,
        );
      case '429':
        log.warn(`Image generation rate-limited: ${message}`);
        return apiError(
          'UPSTREAM_ERROR',
          429,
          `The image provider is rate-limiting requests ${where} (429). Wait a moment and retry.`,
        );
      default:
        break;
    }
    log.error(`Image generation failed: ${message}`, error);
    return apiError('INTERNAL_ERROR', 500, `Image generation failed ${where}`);
  }
}

/**
 * The provider the request names with x-image-provider (deprecated), with the
 * key, base URL and model headers, or undefined when it names none.
 */
async function requestedImageProvider(request: NextRequest): Promise<MediaConnection | undefined> {
  const providerId = request.headers.get('x-image-provider')?.trim() as ImageProviderId | undefined;
  if (!providerId) return undefined;
  // A force-disabled provider is off for everyone (#665).
  if (isServerProviderDisabled('image', providerId)) {
    throw new RequestedProviderRefusedError(
      apiError('PROVIDER_DISABLED', 403, 'This image provider is disabled by the server'),
    );
  }
  // Managed providers are admin-owned: ignore any client-sent key/baseUrl.
  const managed = isServerConfiguredProvider('image', providerId);
  const clientApiKey = managed ? undefined : request.headers.get('x-api-key') || undefined;
  const clientBaseUrl = managed ? undefined : request.headers.get('x-base-url') || undefined;
  if (clientBaseUrl) {
    const ssrfError = await validateClientBaseUrl(clientBaseUrl);
    if (ssrfError) throw new RequestedProviderRefusedError(apiError('INVALID_URL', 403, ssrfError));
  }
  // A managed provider may pin its model list server-side
  // (IMAGE_<PREFIX>_MODELS): an allowlisted client choice wins, otherwise the
  // first pinned entry is the managed default.
  const model = resolveImageModel(
    providerId,
    request.headers.get('x-image-model')?.trim() || undefined,
  );
  return {
    providerId,
    apiKey: resolveImageApiKey(providerId, clientApiKey),
    ...(model ? { modelId: model } : {}),
    baseUrl: resolveImageBaseUrl(providerId, clientBaseUrl),
    managed,
    userEndpoint: Boolean(clientBaseUrl),
    origin: 'request',
  };
}
