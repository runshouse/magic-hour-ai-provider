import { z } from 'zod';

/** Options passed under `providerOptions.magicHour` for image generation. */
export const magicHourImageProviderOptionsSchema = z
  .object({
    /**
     * Output resolution bucket. `auto` lets Magic Hour choose based on the
     * model and your plan.
     */
    resolution: z.enum(['auto', '640px', '1k', '2k', '4k']).nullish(),

    /** Label shown in the Magic Hour dashboard. */
    name: z.string().nullish(),

    /**
     * Return download URLs instead of image bytes. Faster and cheaper on
     * bandwidth when you only intend to hand the URL to a browser. The URLs
     * are presigned and expire.
     */
    returnUrls: z.boolean().nullish(),
  })
  .passthrough();

export type MagicHourImageProviderOptions = z.infer<
  typeof magicHourImageProviderOptionsSchema
>;
