import { describe, expect, it, vi } from 'vitest';

import { huggingFaceS3ConfigFromEnv } from '@/lib/server/huggingface-s3';
import { S3MaterialByteStore } from '@/lib/server/materials/s3-bytes';

type Command = { constructor: { name: string }; input: Record<string, unknown> };

function fakeClient(handler: (command: Command) => unknown) {
  const sent: Command[] = [];
  const client = {
    send: vi.fn(async (command: Command) => {
      sent.push(command);
      return handler(command);
    }),
  };
  return { client: client as never, sent };
}

describe('S3MaterialByteStore', () => {
  it('writes object keys with their content type', async () => {
    const { client, sent } = fakeClient(() => ({}));
    const store = new S3MaterialByteStore({ bucket: 'kelaska', client });

    await store.put('materials/owner/mat-1', Buffer.from('hello'), 'text/plain');

    expect(sent[0]!.constructor.name).toBe('PutObjectCommand');
    expect(sent[0]!.input).toMatchObject({
      Bucket: 'kelaska',
      Key: 'materials/owner/mat-1',
      ContentType: 'text/plain',
    });
  });

  it('maps a missing object to ENOENT', async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    });
    const store = new S3MaterialByteStore({ bucket: 'kelaska', client });

    await expect(store.get('materials/owner/gone')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lists only the objects directly under the prefix', async () => {
    const { client, sent } = fakeClient(() => ({
      Contents: [
        { Key: 'materials/owner/mat-1.extraction/', LastModified: new Date(1) },
        { Key: 'materials/owner/mat-1.extraction/a.json', LastModified: new Date(2) },
      ],
      IsTruncated: false,
    }));
    const store = new S3MaterialByteStore({ bucket: 'kelaska', client });

    await expect(store.list('materials/owner/mat-1.extraction/')).resolves.toEqual([
      { key: 'materials/owner/mat-1.extraction/a.json', modifiedAt: 2 },
    ]);
    expect(sent[0]!.constructor.name).toBe('ListObjectsV2Command');
    expect(sent[0]!.input).toMatchObject({
      Prefix: 'materials/owner/mat-1.extraction/',
      Delimiter: '/',
    });
  });

  it('deletes every object under the prefix in batches', async () => {
    const { client, sent } = fakeClient((command) =>
      command.constructor.name === 'ListObjectsV2Command'
        ? {
            Contents: [{ Key: 'materials/owner/a' }, { Key: 'materials/owner/b' }],
            IsTruncated: false,
          }
        : {},
    );
    const store = new S3MaterialByteStore({ bucket: 'kelaska', client });

    await store.deletePrefix('materials/owner/');

    const deletes = sent.filter((command) => command.constructor.name === 'DeleteObjectsCommand');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.input).toMatchObject({
      Bucket: 'kelaska',
      Delete: {
        Objects: [{ Key: 'materials/owner/a' }, { Key: 'materials/owner/b' }],
        Quiet: true,
      },
    });
  });
});

describe('huggingFaceS3ConfigFromEnv', () => {
  it('stays off without HF_S3_BUCKET', () => {
    expect(huggingFaceS3ConfigFromEnv({})).toBeUndefined();
  });

  it('requires an endpoint and credentials once a bucket is named', () => {
    expect(() => huggingFaceS3ConfigFromEnv({ HF_S3_BUCKET: 'kelaska' })).toThrow(/HF_S3_ENDPOINT/);
    expect(() =>
      huggingFaceS3ConfigFromEnv({
        HF_S3_BUCKET: 'kelaska',
        HF_S3_ENDPOINT: 'https://s3.hf.co/akj2025',
      }),
    ).toThrow(/HF_S3_ACCESS_KEY_ID/);
  });

  it('defaults the region to us-east-1', () => {
    expect(
      huggingFaceS3ConfigFromEnv({
        HF_S3_BUCKET: 'kelaska',
        HF_S3_ENDPOINT: 'https://s3.hf.co/akj2025',
        HF_S3_ACCESS_KEY_ID: 'key',
        HF_S3_SECRET_ACCESS_KEY: 'secret',
      }),
    ).toMatchObject({ bucket: 'kelaska', region: 'us-east-1', accessKeyId: 'key' });
  });
});
