/** Stable error codes shared by SQL functions (RAISE message), API responses and the UI. */
export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EVENT_NOT_FOUND: 404,
  ENTRY_NOT_FOUND: 404,
  QUEUE_PAUSED: 409,
  QUEUE_EMPTY: 409,
  INVALID_TRANSITION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  FAMILY_EXISTS: 409,
  ROLE_EXISTS: 409,
  SYSTEM_ROLE: 409,
  LAST_SUPER_ADMIN: 409,
  GIFT_UNAVAILABLE: 409,
  GIFT_QTY_BELOW_CLAIMS: 409,
  VENDOR_DUPLICATE: 409,
  ACTION_INVALID: 403,
  ACTION_EXPIRED: 410,
  ACTION_USED: 409,
  FAMILY_EVENT_MISMATCH: 422,
  CHECKIN_INVALID: 401,
  CHECKIN_LOCKED: 429,
  INVALID_SIGNATURE: 401,
  NO_SPEECH: 422,
  VOICE_UNAVAILABLE: 503,
  BAD_REQUEST: 400,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export function isErrorCode(s: string): s is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_STATUS, s);
}
