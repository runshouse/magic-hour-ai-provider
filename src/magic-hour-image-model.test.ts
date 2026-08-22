import { describe, expect, it, vi } from 'vitest';
import { createMagicHour } from './magic-hour-provider';

type Call = { url: string; init: RequestInit | undefined };

/**
 * Fetch double whose routes can return a different response each time they're
 * hit, so a poll loop can be walked through queued -> rendering -> complete.
 */
function fakeFetch(routes: Array<[RegExp, unknown | unknown[], number?]>) {
  const calls: Call[] = [];
  const hits = new Map<RegExp, number>();

  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    const route = routes.find(([pattern]) => pattern.test(url));
    if (route == null) throw new Error(`No fake route for ${url}`);

    const [pattern, bodies, status = 200] = route;
    const n = hits.get(pattern) ?? 0;
    hits.set(pattern, n + 1);

    const body = Array.isArray(bodies)
      ? bodies[Math.min(n, bodies.length - 1)]
      : bodies;

    if (body instanceof Uint8Array) {
      return new Response(body as unknown as BodyInit, { status });
    }

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  return { fetch: fn, calls };
}

const baseOptions = {
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: {},
} as const;

const PNG = new Uint8Array([137, 80, 78, 71]);

function body(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init?.body));
}

describe('image generation', () => {
  it('submits, polls, and returns the image bytes', async () => {
    const { fetch, calls } = fakeFetch([
      [/ai-image-generator/, { id: 'img_1' }],
      [
        /image-projects/,
        {
          id: 'img_1',
          status: 'complete',
          downloads: [{ url: 'https://cdn.test/a.png' }],
        },
      ],
      [/cdn\.test/, PNG],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.image('nano-banana-pro').doGenerate({
      ...baseOptions,
      prompt: 'a red bicycle',
    });

    expect(calls[0]!.url).toBe(
      'https://api.magichour.ai/v1/ai-image-generator',
    );
    expect(body(calls[0]!)).toMatchObject({
      model: 'nano-banana-pro',
      image_count: 1,
      resolution: 'auto',
      style: { prompt: 'a red bicycle' },
    });
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toEqual(PNG);
  });

  it('keeps polling while the job is queued', async () => {
    vi.useFakeTimers();
    try {
      const { fetch, calls } = fakeFetch([
        [/ai-image-generator/, { id: 'img_1' }],
        [
          /image-projects/,
          [
            { id: 'img_1', status: 'queued' },
            { id: 'img_1', status: 'rendering' },
            {
              id: 'img_1',
              status: 'complete',
              downloads: [{ url: 'https://cdn.test/a.png' }],
            },
          ],
        ],
        [/cdn\.test/, PNG],
      ]);
      const magicHour = createMagicHour({ apiKey: 'test', fetch });

      const promise = magicHour
        .image()
        .doGenerate({ ...baseOptions, prompt: 'x' });

      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result.images).toHaveLength(1);
      expect(calls.filter(c => /image-projects/.test(c.url))).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults to the `default` model', async () => {
    const { fetch, calls } = fakeFetch([
      [/ai-image-generator/, { id: 'i' }],
      [
        /image-projects/,
        {
          id: 'i',
          status: 'complete',
          downloads: [{ url: 'https://cdn.test/a.png' }],
        },
      ],
      [/cdn\.test/, PNG],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    await magicHour.image().doGenerate({ ...baseOptions, prompt: 'x' });

    expect(body(calls[0]!).model).toBe('default');
  });

  it('reduces a pixel size to an aspect ratio and warns about it', async () => {
    const { fetch, calls } = fakeFetch([
      [/ai-image-generator/, { id: 'i' }],
      [
        /image-projects/,
        {
          id: 'i',
          status: 'complete',
          downloads: [{ url: 'https://cdn.test/a.png' }],
        },
      ],
      [/cdn\.test/, PNG],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.image().doGenerate({
      ...baseOptions,
      prompt: 'x',
      size: '1920x1080',
    });

    expect(body(calls[0]!).aspect_ratio).toBe('16:9');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'compatibility', feature: 'size' }),
    );
  });

  it('passes n through as image_count', async () => {
    const { fetch, calls } = fakeFetch([
      [/ai-image-generator/, { id: 'i' }],
      [
        /image-projects/,
        {
          id: 'i',
          status: 'complete',
          downloads: [
            { url: 'https://cdn.test/a.png' },
            { url: 'https://cdn.test/b.png' },
          ],
        },
      ],
      [/cdn\.test/, PNG],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour
      .image()
      .doGenerate({ ...baseOptions, prompt: 'x', n: 2 });

    expect(body(calls[0]!).image_count).toBe(2);
    expect(result.images).toHaveLength(2);
  });

  it('surfaces a failed job as a thrown error', async () => {
    const { fetch } = fakeFetch([
      [/ai-image-generator/, { id: 'i' }],
      [/image-projects/, { id: 'i', status: 'error', error: 'nsfw' }],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    await expect(
      magicHour.image().doGenerate({ ...baseOptions, prompt: 'x' }),
    ).rejects.toThrow(/nsfw/);
  });

  it('warns about seed, mask and file inputs', async () => {
    const { fetch } = fakeFetch([
      [/ai-image-generator/, { id: 'i' }],
      [
        /image-projects/,
        {
          id: 'i',
          status: 'complete',
          downloads: [{ url: 'https://cdn.test/a.png' }],
        },
      ],
      [/cdn\.test/, PNG],
    ]);
    const magicHour = createMagicHour({ apiKey: 'test', fetch });

    const result = await magicHour.image().doGenerate({
      ...baseOptions,
      prompt: 'x',
      seed: 1,
      mask: { type: 'url', url: 'https://example.com/m.png' },
    });

    const features = result.warnings.map(w =>
      'feature' in w ? w.feature : undefined,
    );
    expect(features).toEqual(expect.arrayContaining(['seed', 'mask']));
  });
});

describe('provider surface', () => {
  it('refuses language models with a useful message', () => {
    const magicHour = createMagicHour({ apiKey: 'test' });

    expect(() => magicHour.languageModel('anything')).toThrow(
      /does not provide language models/,
    );
  });

  it('respects a custom baseURL', async () => {
    const { fetch, calls } = fakeFetch([[/text-to-video/, { id: 'p' }]]);
    const magicHour = createMagicHour({
      apiKey: 'test',
      baseURL: 'https://proxy.internal/mh/',
      fetch,
    });

    await magicHour.video('wan-2.2').doStart!({
      n: 1,
      prompt: 'x',
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
    });

    expect(calls[0]!.url).toBe('https://proxy.internal/mh/text-to-video');
  });

  it('reads the key from MAGIC_HOUR_API_KEY when none is passed', async () => {
    process.env.MAGIC_HOUR_API_KEY = 'from_env';
    try {
      const { fetch, calls } = fakeFetch([[/text-to-video/, { id: 'p' }]]);
      const magicHour = createMagicHour({ fetch });

      await magicHour.video('wan-2.2').doStart!({
        n: 1,
        prompt: 'x',
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
      });

      const headers = new Headers(calls[0]!.init?.headers);
      expect(headers.get('authorization')).toBe('Bearer from_env');
    } finally {
      delete process.env.MAGIC_HOUR_API_KEY;
    }
  });
});
