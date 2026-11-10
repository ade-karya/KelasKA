/**
 * Hugging Face S3 (s3.hf.co) connection settings, shared by every byte layer
 * that stores objects there.
 *
 *   HF_S3_BUCKET     bucket name, e.g. "kelaska" (required to opt in)
 *   HF_S3_ENDPOINT   S3-compatible endpoint, e.g. "https://s3.hf.co/akj2025"
 *                    (namespace in the path, required when HF_S3_BUCKET is set)
 *   HF_S3_ACCESS_KEY_ID / HF_S3_SECRET_ACCESS_KEY
 *                    credentials; falls back to AWS_ACCESS_KEY_ID /
 *                    AWS_SECRET_ACCESS_KEY
 *   HF_S3_REGION     signing region, default "us-east-1"
 *
 * Hugging Face S3 only speaks path-style addressing, so every client built
 * here forces it. Server-only: the SDK is imported on first use, never from a
 * browser bundle.
 */

export interface HuggingFaceS3Config {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** The configuration, or `undefined` when the host did not opt in. */
export function huggingFaceS3ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): HuggingFaceS3Config | undefined {
  const bucket = env.HF_S3_BUCKET?.trim();
  if (!bucket) return undefined;

  const endpoint = env.HF_S3_ENDPOINT?.trim();
  if (!endpoint) {
    throw new Error(
      'HF_S3_BUCKET requires HF_S3_ENDPOINT (e.g. https://s3.hf.co/akj2025) for the Hugging Face S3 byte stores',
    );
  }
  const accessKeyId = env.HF_S3_ACCESS_KEY_ID?.trim() || env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.HF_S3_SECRET_ACCESS_KEY?.trim() || env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'HF_S3_BUCKET requires HF_S3_ACCESS_KEY_ID/HF_S3_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)',
    );
  }

  return {
    bucket,
    endpoint,
    region: env.HF_S3_REGION?.trim() || 'us-east-1',
    accessKeyId,
    secretAccessKey,
  };
}

/** A path-style S3 client for the configured Hugging Face bucket. */
export async function createHuggingFaceS3Client(
  config: HuggingFaceS3Config,
): Promise<import('@aws-sdk/client-s3').S3Client> {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
