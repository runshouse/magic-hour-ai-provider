/**
 * Magic Hour's video catalogue.
 *
 * Every model accepts a different set of clip lengths, and several cap out
 * below the resolution your plan allows. The AI SDK hands us a free-form
 * `duration` in seconds and a `{width}x{height}` resolution, so we snap both to
 * something the API will actually accept and surface a warning, rather than
 * letting the request come back as an opaque 422.
 */

export type MagicHourResolution = '480p' | '720p' | '1080p' | '4k';

/** Ascending, so an index comparison is a quality comparison. */
export const RESOLUTION_ORDER: readonly MagicHourResolution[] = [
  '480p',
  '720p',
  '1080p',
  '4k',
] as const;

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

export type MagicHourVideoModelSpec = {
  /** Clip lengths, in seconds, that this model accepts. */
  durations: number[];
  /** Highest resolution this model can produce, regardless of plan. */
  maxResolution?: MagicHourResolution;
  /** Credits burned per second of output. Used for the cost estimate. */
  creditsPerSecond: number;
  /** Whether Magic Hour's free tier can run it. */
  free?: boolean;
};

export const magicHourVideoModels: Record<string, MagicHourVideoModelSpec> = {
  // --- free plan -----------------------------------------------------------
  'wan-2.2': {
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 15],
    creditsPerSecond: 24,
    free: true,
  },
  'ltx-2.3': {
    durations: [...range(1, 10), 15, 20, 25, 30],
    creditsPerSecond: 24,
    free: true,
  },
  'minimax-h3': {
    durations: [...range(1, 10), 15, 20, 25, 30],
    maxResolution: '1080p',
    creditsPerSecond: 24,
    free: true,
  },

  // --- paid plans ----------------------------------------------------------
  'seedance-1.5': { durations: range(4, 12), creditsPerSecond: 30 },
  'kling-2.6': { durations: [5, 10], creditsPerSecond: 36 },
  'kling-3.0': { durations: range(3, 15), creditsPerSecond: 48 },
  'veo3.1-lite': {
    durations: [4, 6, 8, 16, 24, 32, 40, 48, 56],
    creditsPerSecond: 48,
  },
  'seedance-2.0-mini': {
    durations: range(4, 15),
    maxResolution: '720p',
    creditsPerSecond: 96,
  },
  'veo3.1': {
    durations: [4, 6, 8, 16, 24, 32, 40, 48, 56],
    creditsPerSecond: 96,
  },
  'veo3.1-audio': {
    durations: [4, 6, 8, 16, 24, 32, 40, 48, 56],
    creditsPerSecond: 96,
  },
  'sora-2': {
    durations: [4, 8, 12, 24, 36, 48, 60],
    maxResolution: '720p',
    creditsPerSecond: 120,
  },
  'seedance-2.0': {
    durations: range(4, 15),
    maxResolution: '720p',
    creditsPerSecond: 144,
  },
  'seedance-2.5': {
    durations: range(4, 30),
    maxResolution: '720p',
    creditsPerSecond: 288,
  },
};

/**
 * Model ids known at publish time. The provider does not reject unknown ids —
 * Magic Hour ships models faster than this package can — it just skips the
 * duration and resolution snapping and lets the API be the judge.
 */
export type MagicHourVideoModelId =
  | 'wan-2.2'
  | 'ltx-2.3'
  | 'minimax-h3'
  | 'seedance-1.5'
  | 'kling-2.6'
  | 'kling-3.0'
  | 'veo3.1-lite'
  | 'seedance-2.0-mini'
  | 'veo3.1'
  | 'veo3.1-audio'
  | 'sora-2'
  | 'seedance-2.0'
  | 'seedance-2.5'
  | (string & {});

export type MagicHourImageModelId =
  | 'default'
  | 'gpt-image-2'
  | 'nano-banana-pro'
  | 'seedream-5-pro'
  | 'flux-2-klein'
  | 'z-image-turbo'
  | 'qwen-edit'
  | (string & {});

/** Nearest legal clip length for a model, or the input if the model is unknown. */
export function snapDuration(
  modelId: string,
  duration: number,
): { duration: number; allowed?: number[] } {
  const spec = magicHourVideoModels[modelId];
  if (spec == null) return { duration };

  const [first, ...rest] = spec.durations;
  if (first == null) return { duration };

  const nearest = rest.reduce(
    (best, d) =>
      Math.abs(d - duration) < Math.abs(best - duration) ? d : best,
    first,
  );

  return { duration: nearest, allowed: spec.durations };
}

/** Clamps to the model's ceiling. Plan limits are handled by the API, not here. */
export function capResolution(
  modelId: string,
  resolution: MagicHourResolution,
): MagicHourResolution {
  const cap = magicHourVideoModels[modelId]?.maxResolution;
  if (cap == null) return resolution;

  return RESOLUTION_ORDER.indexOf(resolution) > RESOLUTION_ORDER.indexOf(cap)
    ? cap
    : resolution;
}

/**
 * Turns the AI SDK's `{width}x{height}` into Magic Hour's named tier.
 * Magic Hour names tiers by height, so only the height matters.
 */
export function toMagicHourResolution(
  resolution: `${number}x${number}`,
): MagicHourResolution {
  const height = Number(resolution.split('x')[1]);
  if (!Number.isFinite(height)) return '720p';
  if (height <= 480) return '480p';
  if (height <= 720) return '720p';
  if (height <= 1080) return '1080p';
  return '4k';
}

/** Rough credit cost, so callers can log it before burning quota. */
export function estimateCredits(
  modelId: string,
  durationSeconds: number,
): number | undefined {
  const spec = magicHourVideoModels[modelId];
  return spec == null
    ? undefined
    : Math.round(spec.creditsPerSecond * durationSeconds);
}
