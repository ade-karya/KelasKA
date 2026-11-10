/**
 * Material bytes in an S3-compatible object store.
 *
 * The material byte store keeps its own key namespace (`materials/…`, plus the
 * extraction-result keys derived from it), so it can share the deployment's
 * asset bucket: asset objects are content-hash-named and cannot collide. Keys
 * are the store's own opaque strings; this layer adds no prefix of its own.
 */
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

import type { MaterialByteInput, MaterialByteStore } from './bytes';

const DELETE_BATCH_SIZE = 1_000;

function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { name?: unknown; Code?: unknown }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return code === 'NoSuchKey' || code === 'NotFound' || status === 404;
}

/** The body a PutObjectCommand accepts, without buffering a streamed upload. */
function putBody(body: MaterialByteInput): MaterialByteInput {
  if (body instanceof Readable) return body;
  if (body instanceof ReadableStream) return Readable.fromWeb(body as never);
  return body;
}

export interface S3MaterialByteStoreOptions {
  bucket: string;
  client: S3Client;
}

export class S3MaterialByteStore implements MaterialByteStore {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor({ bucket, client }: S3MaterialByteStoreOptions) {
    this.bucket = bucket;
    this.client = client;
  }

  async put(key: string, body: MaterialByteInput, mime?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: putBody(body),
        ...(mime ? { ContentType: mime } : {}),
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await response.Body?.transformToByteArray();
      return Buffer.from(bytes ?? new Uint8Array());
    } catch (error) {
      if (isMissingObject(error)) {
        throw Object.assign(new Error(`material object not found: ${key}`), {
          code: 'ENOENT',
        });
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string): Promise<Array<{ key: string; modifiedAt: number }>> {
    if (!prefix.endsWith('/')) throw new Error(`invalid material object prefix: ${prefix}`);
    const objects: Array<{ key: string; modifiedAt: number }> = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key || object.Key === prefix) continue;
        objects.push({
          key: object.Key,
          modifiedAt: object.LastModified?.getTime() ?? 0,
        });
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  async deletePrefix(prefix: string): Promise<void> {
    if (!prefix.endsWith('/')) throw new Error(`invalid material object prefix: ${prefix}`);
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (page.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => typeof key === 'string' && key.length > 0);
      for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: keys.slice(index, index + DELETE_BATCH_SIZE).map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }
}
