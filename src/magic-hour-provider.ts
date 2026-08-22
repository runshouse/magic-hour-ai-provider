import type {
  Experimental_VideoModelV4 as VideoModelV4,
  ImageModelV4,
} from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import {
  loadApiKey,
  withoutTrailingSlash,
  type FetchFunction,
} from '@ai-sdk/provider-utils';
import { MagicHourImageModel } from './magic-hour-image-model';
import type {
  MagicHourImageModelId,
  MagicHourVideoModelId,
} from './magic-hour-models';
import { MagicHourVideoModel } from './magic-hour-video-model';

export type MagicHourProviderSettings = {
  /**
   * Magic Hour API key. Falls back to the `MAGIC_HOUR_API_KEY` environment
   * variable. Free key, no card: https://magichour.ai/developer
   */
  apiKey?: string;

  /** Override for self-hosted or proxied deployments. */
  baseURL?: string;

  /** Extra headers sent with every request. */
  headers?: Record<string, string>;

  /** Custom fetch, e.g. for logging, retries or test doubles. */
  fetch?: FetchFunction;
};

export type MagicHourProvider = {
  /**
   * A video model, for `experimental_generateVideo`.
   *
   * ```ts
   * await experimental_generateVideo({
   *   model: magicHour.video('veo3.1'),
   *   prompt: 'a lighthouse in a storm, drone shot',
   * });
   * ```
   */
  video(modelId: MagicHourVideoModelId): VideoModelV4;

  /** Alias of `video`, matching the SDK's `xModel` naming. */
  videoModel(modelId: MagicHourVideoModelId): VideoModelV4;

  /** An image model, for `generateImage`. */
  image(modelId?: MagicHourImageModelId): ImageModelV4;

  /** Alias of `image`. */
  imageModel(modelId?: MagicHourImageModelId): ImageModelV4;

  /**
   * Calling the provider directly is not supported — Magic Hour has no chat
   * model, so there is no sensible default. Use `.video()` or `.image()`.
   */
  languageModel(modelId: string): never;
};

export function createMagicHour(
  settings: MagicHourProviderSettings = {},
): MagicHourProvider {
  const baseURL =
    withoutTrailingSlash(settings.baseURL) ?? 'https://api.magichour.ai/v1';

  const config = {
    provider: 'magicHour',
    url: baseURL,
    headers: () => ({
      Authorization: `Bearer ${loadApiKey({
        apiKey: settings.apiKey,
        environmentVariableName: 'MAGIC_HOUR_API_KEY',
        description: 'Magic Hour',
      })}`,
      ...settings.headers,
    }),
    fetch: settings.fetch,
  };

  const video = (modelId: MagicHourVideoModelId) =>
    new MagicHourVideoModel(modelId, config);

  const image = (modelId: MagicHourImageModelId = 'default') =>
    new MagicHourImageModel(modelId, config);

  return {
    video,
    videoModel: video,
    image,
    imageModel: image,
    languageModel: (modelId: string): never => {
      throw new NoSuchModelError({
        modelId,
        modelType: 'languageModel',
        message:
          'Magic Hour does not provide language models. Use magicHour.video() or magicHour.image().',
      });
    },
  };
}

/** Default instance, reading `MAGIC_HOUR_API_KEY` from the environment. */
export const magicHour = createMagicHour();
