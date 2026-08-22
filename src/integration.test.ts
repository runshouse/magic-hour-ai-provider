import { experimental_generateVideo as generateVideo, generateImage } from 'ai';
import { describe, expect, it } from 'vitest';
import { createMagicHour } from './magic-hour-provider';

/**
 * The unit tests exercise the model classes directly. These go through the
 * real `ai` package instead, which is the only way to know the provider
 * actually satisfies the spec the SDK enforces at runtime — including that the
 * SDK, not this package, drives the poll loop.
 */

function fakeFetch(handler: (url: string) => unknown) {
  const urls: string[] = [];

  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    const body = handler(url);
    if (body instanceof Uint8Array) {
      return new Response(body as unknown as BodyInit);
    }

    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  return { fetch: fn, urls };
}

const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

/**
 * `generateVideo` downloads the finished clip with its own fetch, not the one
 * on the provider, so the fake has to be threaded in here too.
 */
function fakeDownload(fetch: typeof globalThis.fetch) {
  return async ({ url }: { url: URL }) => {
    const response = await fetch(url.toString());
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      mediaType: 'video/mp4',
    };
  };
}

describe('experimental_generateVideo', () => {
  it('drives doStart -> doStatus -> download end to end', async () => {
    let polls = 0;

    const { fetch, urls } = fakeFetch(url => {
      if (url.includes('text-to-video')) return { id: 'proj_1' };
      if (url.includes('video-projects')) {
        polls++;
        return polls < 3
          ? { id: 'proj_1', status: 'rendering' }
          : {
              id: 'proj_1',
              status: 'complete',
              downloads: [{ url: 'https://cdn.test/out.mp4' }],
            };
      }
      if (url.includes('cdn.test')) return MP4;
      throw new Error(`unexpected ${url}`);
    });

    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await generateVideo({
      model: magicHour.video('kling-3.0'),
      prompt: 'a lighthouse in a storm, slow drone push-in',
      duration: 5,
      resolution: '1280x720',
      poll: { intervalMs: 1 },
      download: fakeDownload(fetch),
    });

    expect(polls).toBe(3);
    expect(result.video.uint8Array).toEqual(MP4);
    expect(result.video.mediaType).toBe('video/mp4');
    expect(urls).toContain('https://api.magichour.ai/v1/text-to-video');
  });

  it('accepts an image prompt and routes it to image-to-video', async () => {
    const { fetch, urls } = fakeFetch(url => {
      if (url.includes('upload-urls')) {
        return {
          items: [
            {
              upload_url: 'https://s3.test/put',
              file_path: 'api-assets/f.png',
            },
          ],
        };
      }
      if (url.includes('s3.test')) return {};
      if (url.includes('image-to-video')) return { id: 'proj_2' };
      if (url.includes('video-projects')) {
        return {
          id: 'proj_2',
          status: 'complete',
          downloads: [{ url: 'https://cdn.test/out.mp4' }],
        };
      }
      if (url.includes('cdn.test')) return MP4;
      throw new Error(`unexpected ${url}`);
    });

    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await generateVideo({
      model: magicHour.video('wan-2.2'),
      prompt: {
        image: new Uint8Array([137, 80, 78, 71]),
        text: 'pan slowly across the scene',
      },
      duration: 5,
      poll: { intervalMs: 1 },
      download: fakeDownload(fetch),
    });

    expect(urls).toContain('https://api.magichour.ai/v1/image-to-video');
    expect(result.video.uint8Array).toEqual(MP4);
  });

  it('surfaces snapping warnings through the SDK result', async () => {
    const { fetch } = fakeFetch(url => {
      if (url.includes('text-to-video')) return { id: 'p' };
      if (url.includes('video-projects')) {
        return {
          id: 'p',
          status: 'complete',
          downloads: [{ url: 'https://cdn.test/out.mp4' }],
        };
      }
      return MP4;
    });

    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await generateVideo({
      model: magicHour.video('kling-2.6'),
      prompt: 'x',
      duration: 8, // kling-2.6 only does 5s and 10s
      poll: { intervalMs: 1 },
      download: fakeDownload(fetch),
    });

    expect(result.warnings).toContainEqual(
      expect.objectContaining({ feature: 'duration' }),
    );
  });

  it('propagates a failed render as a thrown error', async () => {
    const { fetch } = fakeFetch(url => {
      if (url.includes('text-to-video')) return { id: 'p' };
      return { id: 'p', status: 'error', error: 'content policy' };
    });

    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    await expect(
      generateVideo({
        model: magicHour.video('wan-2.2'),
        prompt: 'x',
        poll: { intervalMs: 1 },
        download: fakeDownload(fetch),
      }),
    ).rejects.toThrow(/content policy/);
  });
});

describe('generateImage', () => {
  it('works through the SDK helper', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);

    const { fetch } = fakeFetch(url => {
      if (url.includes('ai-image-generator')) return { id: 'img' };
      if (url.includes('image-projects')) {
        return {
          id: 'img',
          status: 'complete',
          downloads: [{ url: 'https://cdn.test/a.png' }],
        };
      }
      return png;
    });

    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await generateImage({
      model: magicHour.image('nano-banana-pro'),
      prompt: 'a red bicycle against a white wall',
    });

    expect(result.image.uint8Array).toEqual(png);
  });
});
