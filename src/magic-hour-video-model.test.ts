import { describe, expect, it } from 'vitest';
import { createMagicHour } from './magic-hour-provider';

type Call = { url: string; init: RequestInit | undefined };

/** Minimal fetch double: match on URL, return canned JSON, record every call. */
function fakeFetch(routes: Array<[RegExp, unknown, number?]>) {
  const calls: Call[] = [];

  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    const route = routes.find(([pattern]) => pattern.test(url));
    if (route == null) {
      throw new Error(`No fake route for ${url}`);
    }

    const [, body, status = 200] = route;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  return { fetch: fn, calls };
}

const baseOptions = {
  n: 1,
  aspectRatio: undefined,
  resolution: undefined,
  duration: undefined,
  fps: undefined,
  seed: undefined,
  image: undefined,
  frameImages: undefined,
  inputReferences: undefined,
  generateAudio: undefined,
  providerOptions: {},
} as const;

function body(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init?.body));
}

describe('doStart', () => {
  it('posts a text-to-video job and returns the project id', async () => {
    const { fetch, calls } = fakeFetch([[/text-to-video/, { id: 'proj_1' }]]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.video('wan-2.2').doStart!({
      ...baseOptions,
      prompt: 'a lighthouse in a storm',
    });

    expect(calls[0]!.url).toBe('https://api.magichour.ai/v1/text-to-video');
    expect(body(calls[0]!)).toMatchObject({
      model: 'wan-2.2',
      end_seconds: 5,
      resolution: '720p',
      style: { prompt: 'a lighthouse in a storm' },
    });
    expect(result.operation).toEqual({ id: 'proj_1', modelId: 'wan-2.2' });
    expect(result.warnings).toEqual([]);
  });

  it('sends the API key as a bearer token', async () => {
    const { fetch, calls } = fakeFetch([[/text-to-video/, { id: 'p' }]]);
    const magicHour = createMagicHour({ apiKey: 'mhk_test', fetch });

    await magicHour.video('wan-2.2').doStart!({ ...baseOptions, prompt: 'x' });

    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer mhk_test');
  });

  it('snaps an unsupported duration to the nearest legal one and warns', async () => {
    const { fetch, calls } = fakeFetch([[/text-to-video/, { id: 'p' }]]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    // kling-2.6 only accepts 5s and 10s.
    const result = await magicHour.video('kling-2.6').doStart!({
      ...baseOptions,
      prompt: 'x',
      duration: 8,
    });

    expect(body(calls[0]!).end_seconds).toBe(10);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'unsupported', feature: 'duration' }),
    );
  });

  it('caps resolution at the model ceiling', async () => {
    const { fetch, calls } = fakeFetch([[/text-to-video/, { id: 'p' }]]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    // sora-2 maxes out at 720p regardless of plan.
    const result = await magicHour.video('sora-2').doStart!({
      ...baseOptions,
      prompt: 'x',
      duration: 4,
      resolution: '1920x1080',
    });

    expect(body(calls[0]!).resolution).toBe('720p');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ feature: 'resolution' }),
    );
  });

  it('maps pixel resolutions onto Magic Hour tiers', async () => {
    const { fetch, calls } = fakeFetch([[/text-to-video/, { id: 'p' }]]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    await magicHour.video('kling-3.0').doStart!({
      ...baseOptions,
      prompt: 'x',
      resolution: '1920x1080',
    });

    expect(body(calls[0]!).resolution).toBe('1080p');
  });

  it('honours providerOptions.magicHour.strict by skipping correction', async () => {
    const { fetch, calls } = fakeFetch([[/text-to-video/, { id: 'p' }]]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    await magicHour.video('kling-2.6').doStart!({
      ...baseOptions,
      prompt: 'x',
      duration: 8,
      providerOptions: { magicHour: { strict: true } },
    });

    expect(body(calls[0]!).end_seconds).toBe(8);
  });

  it('passes an image URL straight through to image-to-video', async () => {
    const { fetch, calls } = fakeFetch([[/image-to-video/, { id: 'p' }]]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    await magicHour.video('wan-2.2').doStart!({
      ...baseOptions,
      prompt: 'pan across it',
      image: { type: 'url', url: 'https://example.com/frame.png' },
    });

    // A public URL needs no upload round-trip.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('image-to-video');
    expect(body(calls[0]!).assets).toEqual({
      image_file_path: 'https://example.com/frame.png',
    });
  });

  it('uploads inline image bytes before submitting', async () => {
    const { fetch, calls } = fakeFetch([
      [
        /files\/upload-urls/,
        {
          items: [
            {
              upload_url: 'https://s3.test/put',
              file_path: 'api-assets/x.png',
            },
          ],
        },
      ],
      [/s3\.test/, {}],
      [/image-to-video/, { id: 'p' }],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    await magicHour.video('wan-2.2').doStart!({
      ...baseOptions,
      prompt: 'animate',
      image: { type: 'file', mediaType: 'image/png', data: 'aGVsbG8=' },
    });

    expect(calls.map(c => c.url)).toEqual([
      'https://api.magichour.ai/v1/files/upload-urls',
      'https://s3.test/put',
      'https://api.magichour.ai/v1/image-to-video',
    ]);
    expect(calls[1]!.init?.method).toBe('PUT');
    expect(body(calls[2]!).assets).toEqual({
      image_file_path: 'api-assets/x.png',
    });
  });

  it('warns about knobs Magic Hour does not expose', async () => {
    const { fetch } = fakeFetch([[/text-to-video/, { id: 'p' }]]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.video('wan-2.2').doStart!({
      ...baseOptions,
      prompt: 'x',
      seed: 42,
      fps: 30,
      n: 3,
    });

    const features = result.warnings.map(w =>
      'feature' in w ? w.feature : undefined,
    );
    expect(features).toEqual(expect.arrayContaining(['seed', 'fps', 'n']));
  });

  it('does not correct models it has never heard of', async () => {
    const { fetch, calls } = fakeFetch([[/text-to-video/, { id: 'p' }]]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.video('some-2027-model').doStart!({
      ...baseOptions,
      prompt: 'x',
      duration: 7,
    });

    expect(body(calls[0]!).end_seconds).toBe(7);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'other' }),
    );
  });
});

describe('doStatus', () => {
  const operation = { id: 'proj_1', modelId: 'wan-2.2' };

  it('reports pending while the job is still rendering', async () => {
    const { fetch } = fakeFetch([
      [/video-projects/, { id: 'proj_1', status: 'rendering' }],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.video('wan-2.2').doStatus!({ operation });

    expect(result.status).toBe('pending');
  });

  it('returns the download URL once complete', async () => {
    const { fetch } = fakeFetch([
      [
        /video-projects/,
        {
          id: 'proj_1',
          status: 'complete',
          downloads: [{ url: 'https://cdn.test/out.mp4' }],
          width: 1280,
          height: 720,
        },
      ],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.video('wan-2.2').doStatus!({ operation });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('unreachable');
    expect(result.videos).toEqual([
      { type: 'url', url: 'https://cdn.test/out.mp4', mediaType: 'video/mp4' },
    ]);
  });

  it('reports errors, and says failed jobs are refunded', async () => {
    const { fetch } = fakeFetch([
      [
        /video-projects/,
        { id: 'proj_1', status: 'error', error: 'content policy' },
      ],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.video('wan-2.2').doStatus!({ operation });

    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('unreachable');
    expect(result.error).toContain('content policy');
    expect(result.error).toContain('refunded');
  });

  it('treats a complete job with no downloads as an error', async () => {
    const { fetch } = fakeFetch([
      [/video-projects/, { id: 'proj_1', status: 'complete', downloads: [] }],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.video('wan-2.2').doStatus!({ operation });

    expect(result.status).toBe('error');
  });
});

describe('errors', () => {
  it('explains tier restrictions instead of echoing a bare 4xx', async () => {
    const { fetch } = fakeFetch([
      [
        /text-to-video/,
        {
          message:
            'Resolution 720p is not available for your subscription tier',
        },
        403,
      ],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    await expect(
      magicHour.video('veo3.1').doStart!({ ...baseOptions, prompt: 'x' }),
    ).rejects.toThrow(/paid Magic Hour plan/);
  });

  it('points at the top-up page when credits run out', async () => {
    const { fetch } = fakeFetch([
      [/text-to-video/, { message: 'Insufficient credits' }, 402],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    await expect(
      magicHour.video('wan-2.2').doStart!({ ...baseOptions, prompt: 'x' }),
    ).rejects.toThrow(/magichour\.ai\/developer/);
  });
});

describe('webhooks', () => {
  it('does not advertise webhook support', () => {
    const magicHour = createMagicHour({ apiKey: 'test' });

    // Magic Hour has no webhook mechanism. Leaving this method undefined is
    // what stops the SDK from spinning up an endpoint it would never call.
    expect(magicHour.video('wan-2.2').handleWebhookOption).toBeUndefined();
  });
});
