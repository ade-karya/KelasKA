import { describe, expect, it } from 'vitest';
import { APICallError, RetryError } from 'ai';
import { friendlyUpstreamChatMessage } from '@/lib/server/llm-error-response';

// Real AI SDK error instances, mirroring tests/server/llm-fallback.test.ts.

function apiError(statusCode: number, message: string, isRetryable?: boolean): APICallError {
  return new APICallError({
    message,
    url: 'https://api.example.com/v1/chat',
    requestBodyValues: {},
    statusCode,
    responseBody: '',
    isRetryable,
  });
}

function retryError(inner: unknown): RetryError {
  return new RetryError({
    message: `Failed after 3 attempts. Last error: ${String(inner)}`,
    reason: 'maxRetriesExceeded',
    errors: [inner],
  });
}

describe('friendlyUpstreamChatMessage', () => {
  it('maps the production 429 RetryError to the rate-limit message', () => {
    expect(friendlyUpstreamChatMessage(retryError(apiError(429, 'Too Many Requests', true)))).toBe(
      'Upstream rate limit reached. Please try again shortly.',
    );
  });

  it('maps a bare 429 APICallError (maxRetries=0 path)', () => {
    expect(friendlyUpstreamChatMessage(apiError(429, 'quota exceeded', true))).toBe(
      'Upstream rate limit reached. Please try again shortly.',
    );
  });

  it('maps capacity 5xx to the unavailable message', () => {
    expect(friendlyUpstreamChatMessage(retryError(apiError(503, 'model overloaded', true)))).toBe(
      'Upstream model provider is temporarily unavailable. Please try again.',
    );
  });

  it('maps auth failures without leaking provider bodies', () => {
    expect(friendlyUpstreamChatMessage(apiError(401, 'bad key', false))).toBe(
      'Upstream authentication failed. Please check the model configuration.',
    );
  });

  it('returns undefined for non-upstream failures so callers keep the original text', () => {
    expect(friendlyUpstreamChatMessage(new Error('whiteboard changed'))).toBeUndefined();
    expect(friendlyUpstreamChatMessage(new Error('Failed after 3 attempts'))).toBeUndefined();
    expect(friendlyUpstreamChatMessage(apiError(400, 'bad request', false))).toBeUndefined();
    expect(friendlyUpstreamChatMessage(undefined)).toBeUndefined();
  });
});
