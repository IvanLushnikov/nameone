/**
 * Классы ошибок API.
 *
 * Бросаем `throw new BadRequestError(...)` в роуте → error middleware ловит,
 * превращает в `{ ok: false, error, code }` с правильным HTTP-статусом.
 *
 * Использовать только для ОЖИДАЕМЫХ ошибок (валидация, auth, лимиты).
 * Непредвиденные баги летят как InternalError автоматически.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class BadRequestError extends ApiError {
  constructor(message = "Bad Request", details?: unknown) {
    super(400, "BAD_REQUEST", message, details);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized", details?: unknown) {
    super(401, "UNAUTHORIZED", message, details);
    this.name = "UnauthorizedError";
  }
}

export class PaymentRequiredError extends ApiError {
  constructor(message = "Payment required", details?: unknown) {
    super(402, "PAYMENT_REQUIRED", message, details);
    this.name = "PaymentRequiredError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden", details?: unknown) {
    super(403, "FORBIDDEN", message, details);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not Found", details?: unknown) {
    super(404, "NOT_FOUND", message, details);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Conflict", details?: unknown) {
    super(409, "CONFLICT", message, details);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends ApiError {
  constructor(message = "Too Many Requests", details?: unknown) {
    super(429, "RATE_LIMIT", message, details);
    this.name = "RateLimitError";
  }
}

export class InternalError extends ApiError {
  constructor(message = "Internal Server Error", details?: unknown) {
    super(500, "INTERNAL", message, details);
    this.name = "InternalError";
  }
}

/** Удобный helper для ad-hoc ошибок. */
export function throwApiError(status: number, code: string, message: string, details?: unknown): never {
  throw new ApiError(status, code, message, details);
}
