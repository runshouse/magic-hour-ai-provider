import type { Experimental_VideoModelV4File as VideoModelV4File } from '@ai-sdk/provider';
import {
  createJsonResponseHandler,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { MagicHourConfig } from './magic-hour-config';
import { magicHourFailedResponseHandler } from './magic-hour-error';

const uploadUrlsResponseSchema = z.object({
  items: z.array(
    z.object({
      upload_url: z.string(),
      file_path: z.string(),
    }),
  ),
});

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

function toBytes(data: string | Uint8Array): Uint8Array {
  if (typeof data !== 'string') return data;

  // Node has Buffer; browsers and workers have atob. Support both without
  // pulling in a dependency.
  if (typeof globalThis.Buffer !== 'undefined') {
    return new Uint8Array(globalThis.Buffer.from(data, 'base64'));
  }

  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Resolves an AI SDK file input into something `assets.image_file_path`
 * accepts.
 *
 * Magic Hour takes either a public HTTPS URL or a `file_path` handed out by
 * its upload endpoint, so a `type: 'url'` input costs nothing — we pass it
 * straight through. Inline bytes take the two-step route: ask for a presigned
 * URL, PUT the bytes at it, then reference the returned path.
 */
export async function resolveFileReference({
  file,
  config,
  abortSignal,
  headers,
}: {
  file: VideoModelV4File;
  config: MagicHourConfig;
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
}): Promise<string> {
  if (file.type === 'url') {
    return file.url;
  }

  const mediaType = file.mediaType ?? 'image/png';
  const extension = EXTENSIONS[mediaType.toLowerCase()] ?? 'png';
  const kind = mediaType.startsWith('video/') ? 'video' : 'image';

  const { value } = await postJsonToApi({
    url: `${config.url}/files/upload-urls`,
    headers: { ...config.headers(), ...headers },
    body: { items: [{ extension, type: kind }] },
    failedResponseHandler: magicHourFailedResponseHandler,
    successfulResponseHandler: createJsonResponseHandler(
      uploadUrlsResponseSchema,
    ),
    abortSignal,
    fetch: config.fetch,
  });

  const item = value.items[0];
  if (item == null) {
    throw new Error('Magic Hour did not return an upload URL.');
  }

  const bytes = toBytes(file.data);
  const doFetch = config.fetch ?? globalThis.fetch;

  const upload = await doFetch(item.upload_url, {
    method: 'PUT',
    body: bytes as unknown as BodyInit,
    headers: { 'Content-Type': mediaType },
    signal: abortSignal,
  });

  if (!upload.ok) {
    throw new Error(
      `Magic Hour upload failed (${upload.status} ${upload.statusText}).`,
    );
  }

  return item.file_path;
}
