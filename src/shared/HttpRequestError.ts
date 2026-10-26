/** Stable failure codes for bounded HTTP response reads. */
export type HttpRequestErrorCode =
  | 'HTTP_RESPONSE_TOO_LARGE'
  | 'HTTP_TOTAL_TIMEOUT'
  | 'HTTP_CANCELLED'
  | 'HTTP_PHASE_TIMEOUT'
  | 'HTTP_INVALID_RESPONSE_LIMIT'
  | 'HTTP_INVALID_MANIFEST';

/** A transport failure that callers can distinguish from a valid empty response. */
export class HttpRequestError extends Error {
  constructor(readonly code: HttpRequestErrorCode, message: string) {
    super(message);
    this.name = 'HttpRequestError';
  }
}
