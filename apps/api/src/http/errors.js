export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message, details) {
  return new AppError(400, "BAD_REQUEST", message, details);
}

export function invalidJson() {
  return new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
}

export function payloadTooLarge() {
  return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
}

export function rateLimited(retryAfter = 1) {
  const error = new AppError(429, "RATE_LIMITED", "Too many requests");
  error.retryAfter = Math.max(1, Math.min(3600, Math.ceil(Number(retryAfter) || 1)));
  return error;
}

export function rateLimitUnavailable() {
  return new AppError(
    503,
    "RATE_LIMIT_UNAVAILABLE",
    "Request protection is temporarily unavailable"
  );
}

export function unauthorized(message = "Authentication required") {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Permission denied") {
  return new AppError(403, "FORBIDDEN", message);
}

export function phoneRequired(message = "创建车或上车前需要授权手机号") {
  return new AppError(403, "PHONE_REQUIRED", message);
}

export function notFound(message = "Resource not found") {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflict(message, details) {
  return new AppError(409, "CONFLICT", message, details);
}
