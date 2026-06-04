/**
 * Application error hierarchy. Every thrown AppError carries an HTTP status,
 * a stable machine `code`, and optional structured `details`. The central
 * error handler maps these to sanitized JSON responses.
 */

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, code: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Оролт буруу байна", details?: unknown) {
    super(400, message, "VALIDATION_ERROR", details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Олдсонгүй") {
    super(404, message, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Давхцал илэрлээ", details?: unknown) {
    super(409, message, "CONFLICT", details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Хэт том өгөгдөл") {
    super(413, message, "PAYLOAD_TOO_LARGE");
  }
}

export class UpstreamError extends AppError {
  constructor(message = "Гадаад үйлчилгээ амжилтгүй", details?: unknown) {
    super(502, message, "UPSTREAM_ERROR", details);
  }
}
