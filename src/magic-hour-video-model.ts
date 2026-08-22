import type {
  Experimental_VideoModelV4 as VideoModelV4,
  Experimental_VideoModelV4CallOptions as VideoModelV4CallOptions,
  Experimental_VideoModelV4OperationStartResult as VideoModelV4OperationStartResult,
  Experimental_VideoModelV4OperationStatusResult as VideoModelV4OperationStatusResult,
  Experimental_VideoModelV4VideoData as VideoModelV4VideoData,
  JSONValue,
  SharedV4Warning,
} from '@ai-sdk/provider';
import { APICallError } from '@ai-sdk/provider';
import {
  createJsonResponseHandler,
  getFromApi,
  parseProviderOptions,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { MagicHourConfig } from './magic-hour-config';
import { magicHourFailedResponseHandler } from './magic-hour-error';
import {
  capResolution,
  estimateCredits,
  magicHourVideoModels,
  snapDuration,
  toMagicHourResolution,
  type MagicHourResolution,
  type MagicHourVideoModelId,
} from './magic-hour-models';
import { resolveFileReference } from './magic-hour-upload';
import { magicHourVideoProviderOptionsSchema } from './magic-hour-video-options';

const submitResponseSchema = z.object({
  id: z.string(),
  credits_charged: z.number().nullish(),
  frame_cost: z.number().nullish(),
});

const projectResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  error: z.unknown().nullish(),
  downloads: z
    .array(z.object({ url: z.string(), expires_at: z.string().nullish() }))
    .nullish(),
  credits_charged: z.number().nullish(),
  total_frame_cost: z.number().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  fps: z.number().nullish(),
  enabled: z.boolean().nullish(),
});

/** Magic Hour's project lifecycle. Anything not terminal means keep waiting. */
const TERMINAL_OK = 'complete';
const TERMINAL_BAD = new Set(['error', 'canceled']);

type MagicHourOperation = {
  id: string;
  /** Model id, carried through so `doStatus` can report it without a lookup. */
  modelId: string;
};

function isOperation(
  value: JSONValue,
): value is MagicHourOperation & JSONValue {
  return (
    typeof value === 'object' &&
    value != null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).id === 'string'
  );
}

export class MagicHourVideoModel implements VideoModelV4 {
  readonly specificationVersion = 'v4' as const;

  /** Magic Hour renders one clip per job. */
  readonly maxVideosPerCall = 1;

  constructor(
    readonly modelId: MagicHourVideoModelId,
    private readonly config: MagicHourConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  private get now(): Date {
    return this.config._internal?.currentDate?.() ?? new Date();
  }

  /**
   * Submits the job and hands back its id. The SDK owns the polling loop from
   * here — see `doStatus`. Magic Hour has no webhook mechanism, so
   * `handleWebhookOption` is deliberately absent: without it the SDK skips
   * creating a webhook endpoint it would only end up ignoring.
   */
  async doStart(
    options: VideoModelV4CallOptions,
  ): Promise<VideoModelV4OperationStartResult> {
    const timestamp = this.now;
    const { body, endpoint, warnings } = await this.buildRequest(options);

    const { value, responseHeaders } = await postJsonToApi({
      url: `${this.config.url}/${endpoint}`,
      headers: { ...this.config.headers(), ...options.headers },
      body,
      failedResponseHandler: magicHourFailedResponseHandler,
      successfulResponseHandler:
        createJsonResponseHandler(submitResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const operation: MagicHourOperation = {
      id: value.id,
      modelId: this.modelId,
    };

    return {
      operation: operation as unknown as JSONValue,
      warnings,
      providerMetadata: {
        magicHour: {
          projectId: value.id,
          ...(value.credits_charged != null
            ? { creditsCharged: value.credits_charged }
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

  async doStatus({
    operation,
    abortSignal,
    headers,
  }: {
    operation: JSONValue;
    abortSignal?: AbortSignal;
    headers?: Record<string, string | undefined>;
  }): Promise<VideoModelV4OperationStatusResult> {
    const timestamp = this.now;

    if (!isOperation(operation)) {
      throw new Error(
        'Magic Hour: malformed operation reference passed to doStatus.',
      );
    }

    const response = {
      timestamp,
      modelId: operation.modelId ?? this.modelId,
      headers: undefined as Record<string, string> | undefined,
    };

    try {
      const { value, responseHeaders } = await getFromApi({
        url: `${this.config.url}/video-projects/${operation.id}`,
        headers: { ...this.config.headers(), ...headers },
        failedResponseHandler: magicHourFailedResponseHandler,
        successfulResponseHandler: createJsonResponseHandler(
          projectResponseSchema,
        ),
        abortSignal,
        fetch: this.config.fetch,
      });

      response.headers = responseHeaders;

      const providerMetadata = {
        magicHour: {
          projectId: value.id,
          status: value.status,
          ...(value.credits_charged != null
            ? { creditsCharged: value.credits_charged }
            : {}),
          ...(value.width != null && value.height != null
            ? { width: value.width, height: value.height }
            : {}),
          ...(value.fps != null ? { fps: value.fps } : {}),
        },
      };

      if (TERMINAL_BAD.has(value.status)) {
        return {
          status: 'error',
          // Failed Magic Hour jobs are auto-refunded, so this costs nothing —
          // worth saying, because "error" usually implies burnt credits.
          error:
            `Magic Hour job ${value.status}: ` +
            `${describeError(value.error)} (credits for failed jobs are refunded automatically)`,
          providerMetadata,
          response,
        };
      }

      if (value.status !== TERMINAL_OK) {
        return { status: 'pending', providerMetadata, response };
      }

      const downloads = value.downloads ?? [];
      if (downloads.length === 0) {
        return {
          status: 'error',
          error:
            'Magic Hour reported the job complete but returned no downloads.',
          providerMetadata,
          response,
        };
      }

      const videos: VideoModelV4VideoData[] = downloads.map(download => ({
        type: 'url',
        url: download.url,
        mediaType: 'video/mp4',
      }));

      return {
        status: 'completed',
        videos,
        warnings: [],
        providerMetadata,
        response,
      };
    } catch (error) {
      // A transport hiccup mid-poll shouldn't kill a render that's still
      // running, but a 4xx is a real answer — surface it.
      if (APICallError.isInstance(error)) {
        return {
          status: 'error',
          error: error.message,
          response: { ...response, headers: error.responseHeaders },
        };
      }
      throw error;
    }
  }

  /**
   * Maps the SDK's call options onto a Magic Hour request body, correcting
   * what can be corrected and warning about what can't.
   */
  private async buildRequest(options: VideoModelV4CallOptions): Promise<{
    body: Record<string, unknown>;
    endpoint: 'text-to-video' | 'image-to-video';
    warnings: SharedV4Warning[];
  }> {
    const warnings: SharedV4Warning[] = [];

    const providerOptions = await parseProviderOptions({
      provider: 'magicHour',
      providerOptions: options.providerOptions,
      schema: magicHourVideoProviderOptionsSchema,
    });

    const strict = providerOptions?.strict === true;
    const known = magicHourVideoModels[this.modelId] != null;

    // --- resolution --------------------------------------------------------
    let resolution: MagicHourResolution =
      (providerOptions?.resolution as MagicHourResolution | undefined) ??
      (options.resolution != null
        ? toMagicHourResolution(options.resolution)
        : '720p');

    if (!strict) {
      const capped = capResolution(this.modelId, resolution);
      if (capped !== resolution) {
        warnings.push({
          type: 'unsupported',
          feature: 'resolution',
          details: `${this.modelId} tops out at ${capped}; using that instead of ${resolution}.`,
        });
        resolution = capped;
      }
    }

    // --- duration ----------------------------------------------------------
    let duration = options.duration ?? 5;

    if (!strict) {
      const snapped = snapDuration(this.modelId, duration);
      if (snapped.duration !== duration) {
        warnings.push({
          type: 'unsupported',
          feature: 'duration',
          details:
            `${this.modelId} does not accept ${duration}s clips; using ${snapped.duration}s. ` +
            `Accepted lengths: ${snapped.allowed?.join(', ')}.`,
        });
        duration = snapped.duration;
      }
    }

    if (!known) {
      warnings.push({
        type: 'other',
        message:
          `'${this.modelId}' is not in this package's model table, so duration and ` +
          `resolution were sent unchanged. If Magic Hour rejects them, check ` +
          `https://docs.magichour.ai for the model's limits.`,
      });
    }

    // --- unsupported knobs -------------------------------------------------
    if (options.n > 1) {
      warnings.push({
        type: 'unsupported',
        feature: 'n',
        details:
          'Magic Hour renders one clip per job. Call generateVideo more than once for more.',
      });
    }
    if (options.fps != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'fps',
        details: 'Magic Hour picks the frame rate per model.',
      });
    }
    if (options.seed != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'seed',
        details: 'Magic Hour does not expose a seed for video generation.',
      });
    }
    if (options.frameImages != null && options.frameImages.length > 0) {
      warnings.push({
        type: 'unsupported',
        feature: 'frameImages',
        details:
          'Magic Hour animates from a single starting image. Pass it as `prompt.image` instead.',
      });
    }
    if (options.inputReferences != null && options.inputReferences.length > 0) {
      warnings.push({
        type: 'unsupported',
        feature: 'inputReferences',
        details: 'Reference-to-video is not exposed through this provider yet.',
      });
    }

    // --- body --------------------------------------------------------------
    const name =
      (providerOptions?.name as string | undefined) ?? 'AI SDK generation';

    const body: Record<string, unknown> = {
      name,
      model: this.modelId,
      end_seconds: duration,
      resolution,
      style: { prompt: options.prompt ?? '' },
    };

    if (options.generateAudio != null) {
      body.audio = options.generateAudio;
    }

    // Pass through anything else the caller put under providerOptions.magicHour
    // so a new API field doesn't require a new release of this package.
    for (const [key, value] of Object.entries(providerOptions ?? {})) {
      if (
        key === 'resolution' ||
        key === 'name' ||
        key === 'strict' ||
        value == null
      ) {
        continue;
      }
      body[key] = value;
    }

    if (options.image != null) {
      const filePath = await resolveFileReference({
        file: options.image,
        config: this.config,
        abortSignal: options.abortSignal,
        headers: options.headers,
      });
      body.assets = { image_file_path: filePath };

      // Image-to-video derives its shape from the input frame.
      if (options.aspectRatio != null && options.aspectRatio !== 'adaptive') {
        warnings.push({
          type: 'unsupported',
          feature: 'aspectRatio',
          details:
            'Image-to-video inherits the aspect ratio of the input image.',
        });
      }

      return { body, endpoint: 'image-to-video', warnings };
    }

    if (options.aspectRatio != null && options.aspectRatio !== 'adaptive') {
      body.aspect_ratio = options.aspectRatio;
    }

    return { body, endpoint: 'text-to-video', warnings };
  }
}

function describeError(error: unknown): string {
  if (error == null) return 'no detail given';
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}

export { estimateCredits };
