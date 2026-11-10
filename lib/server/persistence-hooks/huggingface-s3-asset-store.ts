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
 * the rule that ASSET_S3_BUCKET stays unset. The same bucket holds the
 * material byte store's objects under `materials/…` keys (see
 * `lib/server/materials/s3-bytes.ts`); asset objects are content-hash-named,
 * so the two namespaces cannot collide.
 */
import { createHuggingFaceS3Client, huggingFaceS3ConfigFromEnv } from '@/lib/server/huggingface-s3';

export async function configureHuggingFaceS3AssetStoreFromEnv(): Promise<void> {
  const config = huggingFaceS3ConfigFromEnv();
  if (!config) return;

  const client = await createHuggingFaceS3Client(config);
  const { configureAssetByteStore } = await import('@/lib/server/persistence-hooks');
  configureAssetByteStore({
    name: 'huggingface-s3',
    signsReadUrls: true,
    create: async () => {
      const { S3AssetByteStore } = await import('@openmaic/storage/asset/s3-bytes');
      return new S3AssetByteStore({ bucket: config.bucket, client });
    },
  });
}
