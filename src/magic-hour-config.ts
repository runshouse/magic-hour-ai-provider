import type { FetchFunction } from '@ai-sdk/provider-utils';

export type MagicHourConfig = {
  provider: string;
  /** Base URL with no trailing slash, e.g. `https://api.magichour.ai/v1`. */
  url: string;
  headers: () => Record<string, string | undefined>;
  fetch?: FetchFunction;
  _internal?: {
    currentDate?: () => Date;
  };
};
