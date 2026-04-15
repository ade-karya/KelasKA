/**
 * Imagen (Google) Image Generation Adapter
 *
 * Uses Google's Imagen API for high-fidelity image generation.
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:predict
 *
 * Supported models:
 * - imagen-4.0-generate-001       (Imagen 4 Standard)
 * - imagen-4.0-fast-generate-001  (Imagen 4 Fast)
 * - imagen-4.0-ultra-generate-001 (Imagen 4 Ultra)
 *
 * Authentication: x-goog-api-key header
 *
 * API docs: https://ai.google.dev/gemini-api/docs/imagen
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../types';

const DEFAULT_MODEL = 'imagen-4.0-generate-001';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Map framework aspect ratios to Imagen-supported values */
function toImagenAspectRatio(
  ratio?: '16:9' | '4:3' | '1:1' | '9:16',
): string {
  switch (ratio) {
    case '16:9':
      return '16:9';
    case '4:3':
      return '4:3';
    case '9:16':
      return '9:16';
    case '1:1':
    default:
      return '1:1';
  }
}

/** Estimate output dimensions from aspect ratio (Imagen doesn't return exact sizes) */
function estimateDimensions(ratio: string): { width: number; height: number } {
  switch (ratio) {
    case '16:9':
      return { width: 1024, height: 576 };
    case '4:3':
      return { width: 1024, height: 768 };
    case '9:16':
      return { width: 576, height: 1024 };
    case '3:4':
      return { width: 768, height: 1024 };
    case '1:1':
    default:
      return { width: 1024, height: 1024 };
  }
}

interface ImagenPredictResponse {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
  }>;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

/**
 * Lightweight connectivity test — validates API key by fetching model info.
 */
export async function testImagenConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const url = `${baseUrl}/v1beta/models/${model}`;

  let response: Response | null = null;
  try {
    response = await fetch(`${url}?key=${config.apiKey}`, { method: 'GET' });
  } catch {
    // Direct API unreachable, try header auth
  }
  if (!response || !response.ok) {
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'x-goog-api-key': config.apiKey },
      });
    } catch (_err) {
      return {
        success: false,
        message: `Network error: unable to reach ${baseUrl}. Check your Base URL and network connection.`,
      };
    }
  }

  if (response.ok) {
    return { success: true, message: `Connected to Imagen (${model})` };
  }

  const text = await response.text().catch(() => '');
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    return {
      success: false,
      message: `Invalid API key or unauthorized (${response.status}). Check your API Key and Base URL match the same provider.`,
    };
  }
  return {
    success: false,
    message: `Imagen connectivity failed (${response.status}): ${text}`,
  };
}

export async function generateWithImagen(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const aspectRatio = toImagenAspectRatio(options.aspectRatio);

  const response = await fetch(`${baseUrl}/v1beta/models/${model}:predict`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify({
      instances: [
        {
          prompt: options.prompt,
        },
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio,
        personGeneration: 'allow_adult',
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Imagen image generation failed (${response.status}): ${text}`);
  }

  const data: ImagenPredictResponse = await response.json();

  if (data.error) {
    throw new Error(`Imagen error: ${data.error.code} - ${data.error.message}`);
  }

  const predictions = data.predictions;
  if (!predictions || predictions.length === 0) {
    throw new Error('Imagen returned empty response');
  }

  const imageData = predictions[0].bytesBase64Encoded;
  if (!imageData) {
    throw new Error('Imagen returned no image data');
  }

  const dims = estimateDimensions(aspectRatio);

  return {
    base64: imageData,
    width: options.width || dims.width,
    height: options.height || dims.height,
  };
}
