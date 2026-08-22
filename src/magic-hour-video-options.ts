import { z } from 'zod';

/**
 * Options that have no home in the AI SDK's video call signature.
 *
 * Pass them under `providerOptions.magicHour`:
 *
 * ```ts
 * providerOptions: { magicHour: { resolution: '1080p', name: 'hero clip' } }
 * ```
 */
export const magicHourVideoProviderOptionsSchema = z
  .object({
    /**
     * Magic Hour's named resolution tier. Takes precedence over the SDK's
     * `resolution`, which has to be expressed as `{width}x{height}`.
     */
    resolution: z.enum(['480p', '720p', '1080p', '4k']).nullish(),

    /** Label shown in the Magic Hour dashboard. Handy for debugging. */
    name: z.string().nullish(),

    /**
     * Skip the duration/resolution snapping and send exactly what was asked
     * for. Useful when Magic Hour adds a model this package hasn't caught up
     * with; you'll get the API's own error instead of a silent correction.
     */
    strict: z.boolean().nullish(),
  })
  .passthrough();

export type MagicHourVideoProviderOptions = z.infer<
  typeof magicHourVideoProviderOptionsSchema
>;
