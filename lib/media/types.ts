/**
 * Media (Image & Video) Generation Provider Type Definitions
 *
 * Unified types for image generation and video generation
 * with extensible architecture to support multiple providers.
 *
 * Currently Supported Image Providers:
 * - Seedream (ByteDance SDXL-based image generation)
 * - OpenAI Image (GPT Image API)
 * - Qwen Image (Alibaba Cloud Wanx image generation)
 * - Nano Banana (Lightweight image generation via Banana.dev)
 *
 * Currently Supported Video Providers (Phase 2):
 * - Seedance (ByteDance video generation)
 * - Kling (Kuaishou video generation)
 * - Veo (Google DeepMind video generation)
 * - HappyHorse (Alibaba Cloud Model Studio video generation)
 *
 * HOW TO ADD A NEW PROVIDER:
 *
 * Step 1: Add provider ID to the union type
 *   - For Image: Add to ImageProviderId below
 *   - For Video: Add to VideoProviderId below
 *
 * Step 2: Add provider configuration to constants.ts
 *   - Define provider metadata (name, icon, aspect ratios, styles, etc.)
 *   - Add to IMAGE_PROVIDERS or VIDEO_PROVIDERS registry
 *
 * Step 3: Implement provider logic in image-providers.ts or video-providers.ts
 *   - Add case to generateImage() or generateVideo() switch statement
 *   - Implement API call logic for the new provider
 *   - For async task-based providers, use runPolledTask from lib/media/polled-task.ts
 *
 * Step 4: Add i18n translations
 *   - Add provider name translations in lib/i18n.ts
 *   - Format: `provider{ProviderName}Image` or `provider{ProviderName}Video`
 *
 * Step 5 (Optional): Add provider-specific options
 *   - Extend ImageGenerationOptions or VideoGenerationOptions as needed
 *   - Document provider-specific parameters in JSDoc
 *
 * Example: Adding DALL-E Image Provider
 * =======================================
 * 1. Add 'dall-e' to ImageProviderId union type
 * 2. In constants.ts:
 *    IMAGE_PROVIDERS['dall-e'] = {
 *      id: 'dall-e',
 *      name: 'DALL-E',
 *      requiresApiKey: true,
 *      defaultBaseUrl: 'https://api.openai.com/v1',
 *      icon: '/openai.svg',
 *      supportedAspectRatios: ['1:1', '16:9', '9:16'],
 *      supportedStyles: ['natural', 'vivid'],
 *      maxResolution: { width: 1024, height: 1024 }
 *    }
 * 3. In image-providers.ts:
 *    case 'dall-e':
 *      return await generateDallEImage(config, options);
 * 4. In i18n.ts:
 *    providerDallEImage: 'DALL-E' / 'DALL-E 图像生成'
 */

// ============================================================================
// Image Generation Types
// ============================================================================

/**
 * Image Provider IDs
 *
 * Add new image providers here as union members.
 * Keep in sync with IMAGE_PROVIDERS registry in constants.ts
 */
export type ImageProviderId =
  | 'seedream'
  | 'openai-image'
  | 'qwen-image'
  | 'nano-banana'
  | 'minimax-image'
  | 'grok-image'
  | 'comfyui-image'
  | 'openrouter-image'
  | 'huggingface-image'
  | 'lemonade';
// Add new image providers below (uncomment and modify):
// | 'dall-e'
// | 'midjourney'
// | 'stable-diffusion'

/**
 * Image Provider Configuration
 *
 * Describes the capabilities and metadata of an image generation provider.
 * Used to populate UI controls and validate generation requests.
 */
/** Model metadata for an image generation model */
export interface ImageModelInfo {
  /** Model identifier passed to the API */
  id: string;
  /** Human-readable display name */
  name: string;
}

export interface ImageProviderConfig {
  /** Unique provider identifier */
  id: ImageProviderId;
  /** Human-readable provider name */
  name: string;
  /** Whether the provider requires an API key for authentication */
  requiresApiKey: boolean;
  /** Default API base URL (can be overridden in user settings) */
  defaultBaseUrl?: string;
  /** Path to provider icon asset */
  icon?: string;
  /** Available models for this provider */
  models: ImageModelInfo[];
  /** Aspect ratios supported by this provider */
  supportedAspectRatios: Array<'16:9' | '4:3' | '1:1' | '9:16'>;
  /** Optional artistic styles supported by this provider */
  supportedStyles?: string[];
  /** Maximum supported output resolution */
  maxResolution?: {
    width: number;
    height: number;
  };
}

/**
 * Image Generation Configuration
 *
 * Runtime configuration for making image generation API calls.
 * Combines provider selection with authentication credentials.
 */
/**
 * The `fetch`-shaped transport a media adapter issues every provider request
 * with. Server callers pass the pinned provider transport
 * (`lib/server/media-provider-fetch.ts`); left unset, adapters use the global
 * `fetch`.
 */
export type MediaProviderFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ImageGenerationConfig {
  /** Which image provider to use */
  providerId: ImageProviderId;
  /** API key for authentication */
  apiKey: string;
  /** Optional override for the provider's base URL */
  baseUrl?: string;
  /** Optional model ID override (uses provider default if omitted) */
  model?: string;
  /** Transport for provider requests (see {@link MediaProviderFetch}). */
  fetchImpl?: MediaProviderFetch;
}

/**
 * Image Generation Options
 *
 * Parameters for a single image generation request.
 * Passed alongside ImageGenerationConfig to the provider.
 */
export interface ImageGenerationOptions {
  /** Text prompt describing the desired image */
  prompt: string;
  /** Optional negative prompt to exclude undesired elements */
  negativePrompt?: string;
  /** Desired output width in pixels */
  width?: number;
  /** Desired output height in pixels */
  height?: number;
  /** Desired aspect ratio (provider will calculate dimensions if width/height not set) */
  aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16';
  /** Optional artistic style (must be supported by the chosen provider) */
  style?: string;
  /**
   * FLUX.1-dev `/infer` parameters (Hugging Face FLUX provider only; every
   * other provider ignores them). Defaults mirror the Space's API docs:
   * seed 0, randomize_seed true, guidance_scale 3.5, num_inference_steps 28.
   */
  seed?: number;
  /** When true (default), the Space randomizes the seed per call. */
  randomizeSeed?: boolean;
  /** CFG strength for the FLUX.1-dev `/infer` endpoint. */
  guidanceScale?: number;
  /** Denoising steps for the FLUX.1-dev `/infer` endpoint. */
  numInferenceSteps?: number;
  /** Owning stage, for server-side attribution of a generation call. */
  stageId?: string;
  /** Cancel server-side provider I/O (agent runtime / background callers). */
  signal?: AbortSignal;
}

/**
 * Image Generation Result
 *
 * The output of a successful image generation request.
 * Contains either a URL or base64-encoded image data (or both).
 */
export interface ImageGenerationResult {
  /** URL to the generated image (if hosted by the provider) */
  url?: string;
  /** Base64-encoded image data (if returned inline) */
  base64?: string;
  /**
   * Media type of the generated bytes, when the adapter knows it.
   *
   * An adapter that receives inline bytes picks this up from the provider's own
   * metadata, or from the container signature when the provider reports none.
   * It is the only signal for bytes whose URL would otherwise be the provider's
   * own link, so consumers that record or name the bytes use it instead of
   * assuming a type.
   */
  mimeType?: string;
  /** Width of the generated image in pixels */
  width: number;
  /** Height of the generated image in pixels */
  height: number;
}

// ============================================================================
// Video Generation Types (Phase 2)
// ============================================================================

/**
 * Video Provider IDs
 *
 * Add new video providers here as union members.
 * Keep in sync with VIDEO_PROVIDERS registry in constants.ts
 */
export type VideoProviderId =
  | 'seedance'
  | 'kling'
  | 'veo'
  | 'minimax-video'
  | 'grok-video'
  | 'openrouter-video'
  | 'huggingface-video'
  | 'happyhorse';
// Add new video providers below (uncomment and modify):
// | 'runway'
// | 'pika'

/**
 * Video Provider Configuration
 *
 * Describes the capabilities and metadata of a video generation provider.
 * Used to populate UI controls and validate generation requests.
 */
/** Model metadata for a video generation model (same shape as image) */
export type VideoModelInfo = ImageModelInfo;

export interface VideoProviderConfig {
  /** Unique provider identifier */
  id: VideoProviderId;
  /** Human-readable provider name */
  name: string;
  /** Whether the provider requires an API key for authentication */
  requiresApiKey: boolean;
  /**
   * Whether the provider animates a source still instead of dreaming motion
   * from text (image-to-video, e.g. Hugging Face LivePortrait). Callers
   * without a `sourceImageUrl` generate the still first — the "video based
   * on the generated image" flow — rather than failing.
   */
  requiresSourceImage?: boolean;
  /** Default API base URL (can be overridden in user settings) */
  defaultBaseUrl?: string;
  /** Path to provider icon asset */
  icon?: string;
  /** Available models for this provider */
  models: VideoModelInfo[];
  /** Aspect ratios supported by this provider */
  supportedAspectRatios: Array<'16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '21:9'>;
  /** Supported video durations in seconds */
  supportedDurations?: number[];
  /** Supported output resolutions */
  supportedResolutions?: Array<'480p' | '720p' | '1080p'>;
  /** Maximum video duration in seconds */
  maxDuration?: number;
}

/**
 * Video Generation Configuration
 *
 * Runtime configuration for making video generation API calls.
 * Combines provider selection with authentication credentials.
 */
export interface VideoGenerationConfig {
  /** Which video provider to use */
  providerId: VideoProviderId;
  /** API key for authentication */
  apiKey: string;
  /** Optional override for the provider's base URL */
  baseUrl?: string;
  /** Optional model ID override (uses provider default if omitted) */
  model?: string;
  /** Transport for provider requests (see {@link MediaProviderFetch}). */
  fetchImpl?: MediaProviderFetch;
  /**
   * Transport for downloading a finished clip from a provider-returned file
   * URI that may redirect to storage. It follows redirects, re-validating
   * every hop and dropping credential headers on a cross-origin hop
   * (`lib/server/media-provider-fetch.ts`). Left unset, the download uses
   * `fetchImpl` and refuses redirects.
   */
  downloadFetchImpl?: MediaProviderFetch;
}

/**
 * Video Generation Options
 *
 * Parameters for a single video generation request.
 * Passed alongside VideoGenerationConfig to the provider.
 */
export interface VideoGenerationOptions {
  /** Text prompt describing the desired video */
  prompt: string;
  /** Desired video duration in seconds */
  duration?: number;
  /** Desired aspect ratio */
  aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '21:9';
  /** Desired output resolution */
  resolution?: '480p' | '720p' | '1080p';
  /**
   * Source image to animate (image-to-video providers such as Hugging Face
   * LivePortrait): an `https:` URL or `data:` URL of a previously generated
   * image. Text-to-video providers ignore it.
   */
  sourceImageUrl?: string;
  /**
   * Optional driving-motion video override (image-to-video providers): an
   * `https:` URL or `data:` URL. When omitted the provider's default motion
   * applies.
   */
  drivingVideoUrl?: string;
  /**
   * LivePortrait `/gpu_wrapped_execute_video` flags (API docs defaults: all
   * `true`). `relativeMotion` keeps the driving motion relative to the source
   * pose, `doCrop` crops the source face before animation, `pasteBack`
   * pastes the animated face back onto the original frame. Omitted flags
   * default to `true`, mirroring the Space.
   */
  relativeMotion?: boolean;
  doCrop?: boolean;
  pasteBack?: boolean;
  /** Owning stage, for server-side attribution of a generation call. */
  stageId?: string;
  /** Cancel server-side provider I/O (agent runtime / background callers). */
  signal?: AbortSignal;
}

/**
 * Video Generation Result
 *
 * The output of a successful video generation request.
 * Contains the URL to the generated video along with metadata.
 */
export interface VideoGenerationResult {
  /** URL to the generated video */
  url: string;
  /** Duration of the generated video in seconds */
  duration: number;
  /** Width of the generated video in pixels */
  width: number;
  /** Height of the generated video in pixels */
  height: number;
  /** Optional URL to a poster/thumbnail image for the video */
  poster?: string;
}

// ============================================================================
// Shared / Cross-cutting Types
// ============================================================================

/**
 * Media Generation Request
 *
 * A unified request type used by the whiteboard/canvas to request
 * media generation. Maps to either image or video generation internally.
 */
export interface MediaGenerationRequest {
  /** Type of media to generate */
  type: 'image' | 'video';
  /** Text prompt describing the desired media */
  prompt: string;
  /** Identifier for the target element on the canvas (e.g. "gen_img_1") */
  elementId: string;
  /** Desired aspect ratio */
  aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16';
  /** Optional artistic style hint */
  style?: string;
  /**
   * Optional source image for video requests (image-to-video providers):
   * an `https:` URL or `data:` URL of a previously generated image to
   * animate. Forwarded to `/api/generate/video` as `sourceImageUrl`.
   */
  sourceImageUrl?: string;
}
