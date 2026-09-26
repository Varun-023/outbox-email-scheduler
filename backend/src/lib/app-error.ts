import type { ErrorCode, ErrorDetail } from '@outbox/shared';

/** An error that maps directly onto the API error envelope. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}
