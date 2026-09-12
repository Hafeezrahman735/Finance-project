import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

/**
 * Error envelope (docs/architecture.md, DX decision #72):
 *
 *   { message, error: { type, code, message, param?, requestId } }
 *
 * `message` is kept at the top level because the current web app reads
 * `error.response.data.message`; new client code switches on `error.code`.
 */
export type ErrorType = "validation_error" | "authentication_error" | "permission_error" | "not_found" | "conflict" | "internal_error";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: ErrorType,
    public readonly code: string,
    message: string,
    public readonly param?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, param?: string) {
    super(400, "validation_error", "invalid_param", message, param);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Not authorized", code = "unauthorized") {
    super(401, "authentication_error", code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that", code = "forbidden") {
    super(403, "permission_error", code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", code = "not_found") {
    super(404, "not_found", code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super(409, "conflict", code, message);
  }
}

function envelope(status: number, type: ErrorType, code: string, message: string, requestId: string, param?: string) {
  return { message, error: { type, code, message, ...(param ? { param } : {}), requestId } };
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json(envelope(404, "not_found", "route_not_found", `No route for ${req.method} ${req.originalUrl}`, req.id));
}

// Express 5 forwards rejected promises here automatically; no async wrapper needed.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) req.log.error({ err }, err.message);
    res.status(err.status).json(envelope(err.status, err.type, err.code, err.message, req.id, err.param));
    return;
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const param = first?.path.join(".") || undefined;
    const message = param ? `${param} ${first?.message.toLowerCase()}` : first?.message ?? "Invalid request";
    res.status(400).json(envelope(400, "validation_error", "invalid_param", message, req.id, param));
    return;
  }
  // multer: file too large / wrong field
  if (typeof err === "object" && err !== null && (err as { name?: string }).name === "MulterError") {
    const code = (err as { code?: string }).code;
    const message = code === "LIMIT_FILE_SIZE" ? "File is larger than 10 MB; split it and import in parts" : `Upload rejected (${code ?? "unknown"})`;
    res.status(400).json(envelope(400, "validation_error", code === "LIMIT_FILE_SIZE" ? "file_too_large" : "upload_rejected", message, req.id, "file"));
    return;
  }
  // Malformed JSON body from express.json()
  if (typeof err === "object" && err !== null && (err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json(envelope(400, "validation_error", "invalid_json", "Request body is not valid JSON", req.id));
    return;
  }
  req.log.error({ err }, "unhandled error");
  res
    .status(500)
    .json(envelope(500, "internal_error", "internal_error", `Something went wrong. Quote request id ${req.id} when reporting this.`, req.id));
}
