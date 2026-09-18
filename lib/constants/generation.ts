/**
 * Constants for PDF content generation
 * Shared between client and server code
 */

// PDF content truncation limit (characters)
export const MAX_PDF_CONTENT_CHARS = 50000;

// Maximum number of images to send as vision content parts
export const MAX_VISION_IMAGES = 20;

// Size cap for one course material document (bytes), enforced by the extract
// route on both the multipart and asset-id forms and by the vision-image
// resolution (`resolveVisionImagesForPrompt`) so an oversized asset is
// rejected at `identify` — before any bytes are materialized.
export const MAX_EXTRACT_DOCUMENT_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// Vercel Functions reject request bodies above ~4.5 MB with a platform-level
// 413 (`FUNCTION_PAYLOAD_TOO_LARGE`) before the app's own 413 can run. The
// default cap therefore cannot be reached on Vercel; deployments there should
// set EXTRACT_DOCUMENT_MAX_SIZE_BYTES to a value below the platform limit so
// oversized files get the app's explicit, actionable rejection instead.
export function resolveExtractDocumentFileLimitBytes(): number {
  const raw = process.env.EXTRACT_DOCUMENT_MAX_SIZE_BYTES?.trim();
  if (raw && Number.isFinite(Number(raw)) && Number(raw) > 0) {
    return Math.floor(Number(raw));
  }
  return MAX_EXTRACT_DOCUMENT_FILE_SIZE_BYTES;
}
