import {
  createJsonErrorResponseHandler,
  type ResponseHandler,
} from '@ai-sdk/provider-utils';
import type { APICallError } from '@ai-sdk/provider';
import { z } from 'zod';

/**
 * Magic Hour is not consistent about which key holds the message — validation
 * failures come back under `detail`, business errors under `message` or
 * `error`. Accept all of them and keep the raw body around, because a bare
 * "422 Unprocessable Entity" tells the caller nothing about what to fix.
 */
const magicHourErrorSchema = z
  .object({
    message: z.string().nullish(),
    error: z.string().nullish(),
    detail: z.unknown().nullish(),
    code: z.string().nullish(),
  })
  .passthrough();

export type MagicHourErrorData = z.infer<typeof magicHourErrorSchema>;

function describe(error: MagicHourErrorData): string {
  if (typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }
  if (typeof error.error === 'string' && error.error.length > 0) {
    return error.error;
  }
  if (error.detail != null) {
    return typeof error.detail === 'string'
      ? error.detail
      : JSON.stringify(error.detail);
  }
  return JSON.stringify(error);
}

export const magicHourFailedResponseHandler: ResponseHandler<APICallError> =
  createJsonErrorResponseHandler({
    errorSchema: magicHourErrorSchema,
    errorToMessage: error => {
      const message = describe(error);

      // Turn the two failures every new key hits into something actionable.
      if (/subscription tier/i.test(message)) {
        return `${message} — this model or resolution needs a paid Magic Hour plan. See https://magichour.ai/pricing`;
      }
      if (/credit/i.test(message)) {
        return `${message} — top up at https://magichour.ai/developer`;
      }

      return message;
    },
    // 429 and 5xx are worth retrying; a 4xx validation error never is.
    isRetryable: response => response.status === 429 || response.status >= 500,
  });
