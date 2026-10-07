/**
 * Asset bytes in a Hugging Face S3 bucket (s3.hf.co), selected by env:
 *
 *   HF_S3_BUCKET     bucket name, e.g. "kelaska" (required to opt in)
 *   HF_S3_ENDPOINT   S3-compatible endpoint, e.g. "https://s3.hf.co/akj2025"
 *                    (namespace in the path, required when HF_S3_BUCKET is set)
 *   HF_S3_ACCESS_KEY_ID / HF_S3_SECRET_ACCESS_KEY
 *                    credentials; falls back to AWS_ACCESS_KEY_ID /
 *                    AWS_SECRET_ACCESS_KEY
 *   HF_S3_REGION     signing region, default "us-east-1"
 *
 * Hugging Face S3 only speaks path-style addressing, which the built-in
 * ASSET_S3_BUCKET byte store cannot express (it constructs `new S3Client({})`,
 * virtual-hosted style, default endpoint) — hence this registered store and
 * the rule that ASSET_S3_BUCKET stays unset.
 */
export async function configureHuggingFaceS3AssetStoreFromEnv(): Promise<void> {
  const bucket = process.env.HF_S3_BUCKET?.trim();
  if (!bucket) return;

  const endpoint = process.env.HF_S3_ENDPOINT?.trim();
  if (!endpoint) {
    throw new Error(
      'HF_S3_BUCKET requires HF_S3_ENDPOINT (e.g. https://s3.hf.co/akj2025) for the Hugging Face S3 byte store',
    );
  }
  const accessKeyId =
    process.env.HF_S3_ACCESS_KEY_ID?.trim() || process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey =
    process.env.HF_S3_SECRET_ACCESS_KEY?.trim() || process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'HF_S3_BUCKET requires HF_S3_ACCESS_KEY_ID/HF_S3_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)',
    );
  }
  const region = process.env.HF_S3_REGION?.trim() || 'us-east-1';

  const { configureAssetByteStore } = await import('@/lib/server/persistence-hooks');
  configureAssetByteStore({
    name: 'huggingface-s3',
    signsReadUrls: true,
    create: async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const { S3AssetByteStore } = await import('@openmaic/storage/asset/s3-bytes');
      return new S3AssetByteStore({
        bucket,
        client: new S3Client({
          endpoint,
          region,
          forcePathStyle: true,
          credentials: { accessKeyId, secretAccessKey },
        }),
      });
    },
  });
}
