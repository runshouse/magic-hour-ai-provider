import type {
  ImageModelV4,
  ImageModelV4CallOptions,
  ImageModelV4Result,
  SharedV4Warning,
} from '@ai-sdk/provider';
import {
  createBinaryResponseHandler,
  createJsonResponseHandler,
  createStatusCodeErrorResponseHandler,
  getFromApi,
  parseProviderOptions,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { MagicHourConfig } from './magic-hour-config';
import { magicHourFailedResponseHandler } from './magic-hour-error';
import type { MagicHourImageModelId } from './magic-hour-models';
import { magicHourImageProviderOptionsSchema } from './magic-hour-image-options';

const submitResponseSchema = z.object({
  id: z.string(),
  credits_charged: z.number().nullish(),
});

const projectResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  error: z.unknown().nullish(),
  downloads: z
    .array(z.object({ url: z.string(), expires_at: z.string().nullish() }))
    .nullish(),
  credits_charged: z.number().nullish(),
});

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

/**
 * Magic Hour's image endpoint is async like its video one, but `ImageModelV4`
 * has no start/status pair — only `doGenerate` — so the polling loop lives
 * here rather than in the SDK.
 */
export class MagicHourImageModel implements ImageModelV4 {
  readonly specificationVersion = 'v4' as const;

  /** Magic Hour caps a single image job at 16 outputs. */
  readonly maxImagesPerCall = 16;

  constructor(
    readonly modelId: MagicHourImageModelId,
    private readonly config: MagicHourConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  private get now(): Date {
    return this.config._internal?.currentDate?.() ?? new Date();
  }

  async doGenerate(
    options: ImageModelV4CallOptions,
  ): Promise<ImageModelV4Result> {
    const timestamp = this.now;
    const warnings: SharedV4Warning[] = [];

    const providerOptions = await parseProviderOptions({
      provider: 'magicHour',
      providerOptions: options.providerOptions,
      schema: magicHourImageProviderOptionsSchema,
    });

    if (options.seed != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'seed',
        details: 'Magic Hour does not expose a seed for image generation.',
      });
    }
    if (options.mask != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'mask',
        details: 'Inpainting is not exposed through this provider yet.',
      });
    }
    if (options.files != null && options.files.length > 0) {
      warnings.push({
        type: 'unsupported',
        feature: 'files',
        details:
          'Image editing and variations are not exposed through this provider yet.',
      });
    }

    const aspectRatio =
      options.aspectRatio ??
      (options.size != null ? sizeToAspectRatio(options.size) : undefined);

    if (options.size != null && options.aspectRatio == null) {
      warnings.push({
        type: 'compatibility',
        feature: 'size',
        details:
          `Magic Hour takes an aspect ratio and a resolution tier rather than exact pixels. ` +
          `'${options.size}' was read as ${aspectRatio}; set ` +
          `providerOptions.magicHour.resolution to pick the tier.`,
      });
    }

    const body: Record<string, unknown> = {
      name:
        (providerOptions?.name as string | undefined) ?? 'AI SDK generation',
      model: this.modelId,
      image_count: options.n,
      style: { prompt: options.prompt ?? '' },
      resolution: (providerOptions?.resolution as string | undefined) ?? 'auto',
    };

    if (aspectRatio != null) {
      body.aspect_ratio = aspectRatio;
    }

    const { value: submitted, responseHeaders } = await postJsonToApi({
      url: `${this.config.url}/ai-image-generator`,
      headers: { ...this.config.headers(), ...options.headers },
      body,
      failedResponseHandler: magicHourFailedResponseHandler,
      successfulResponseHandler:
        createJsonResponseHandler(submitResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const urls = await this.pollForDownloads({
      projectId: submitted.id,
      abortSignal: options.abortSignal,
      headers: options.headers,
    });

    const images = await Promise.all(
      urls.map(url =>
        getFromApi({
          url,
          failedResponseHandler: createStatusCodeErrorResponseHandler(),
          successfulResponseHandler: createBinaryResponseHandler(),
          abortSignal: options.abortSignal,
          fetch: this.config.fetch,
          // The URL comes from a provider response body, so route it through
          // the SDK's redirect validation rather than trusting it outright.
          validateUrl: true,
        }).then(result => result.value),
      ),
    );

    return {
      images,
      warnings,
      providerMetadata: {
        magicHour: {
          // The spec requires a per-image array here; the presigned download
          // URL is the useful thing to hand back for each one.
          images: urls.map(url => ({ url })),
          projectId: submitted.id,
          ...(submitted.credits_charged != null
            ? { creditsCharged: submitted.credits_charged }
            : {}),
        },
      },
      response: {
        timestamp,
        modelId: this.modelId,
        headers: responseHeaders,
      },
    };
  }

  private async pollForDownloads({
    projectId,
    abortSignal,
    headers,
  }: {
    projectId: string;
    abortSignal?: AbortSignal;
    headers?: Record<string, string | undefined>;
  }): Promise<string[]> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const { value } = await getFromApi({
        url: `${this.config.url}/image-projects/${projectId}`,
        headers: { ...this.config.headers(), ...headers },
        failedResponseHandler: magicHourFailedResponseHandler,
        successfulResponseHandler: createJsonResponseHandler(
          projectResponseSchema,
        ),
        abortSignal,
        fetch: this.config.fetch,
      });

      if (value.status === 'complete') {
        const urls = (value.downloads ?? []).map(d => d.url);
        if (urls.length === 0) {
          throw new Error(
            'Magic Hour reported the job complete but returned no downloads.',
          );
        }
        return urls;
      }

      if (value.status === 'error' || value.status === 'canceled') {
        throw new Error(
          `Magic Hour job ${value.status}: ` +
            `${value.error == null ? 'no detail given' : JSON.stringify(value.error)} ` +
            `(credits for failed jobs are refunded automatically)`,
        );
      }

      await sleep(POLL_INTERVAL_MS, abortSignal);
    }

    throw new Error(
      `Magic Hour image job ${projectId} did not finish within ` +
        `${POLL_TIMEOUT_MS / 60_000} minutes. It may still complete — check ` +
        `https://magichour.ai/developer`,
    );
  }
}

function sizeToAspectRatio(
  size: `${number}x${number}`,
): `${number}:${number}` | undefined {
  const [w, h] = size.split('x').map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || !w || !h) return undefined;

  const divisor = gcd(w, h);
  return `${w / divisor}:${h / divisor}` as `${number}:${number}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
