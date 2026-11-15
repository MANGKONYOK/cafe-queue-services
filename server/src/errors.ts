import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";

/** A refusal the client may see: status, stable code, safe message, optional details. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const unauthorized = () => new AppError(401, "UNAUTHORIZED", "Authentication required.");
export const forbidden = () => new AppError(403, "FORBIDDEN", "You are not allowed to do this.");
export const notFound = () => new AppError(404, "NOT_FOUND", "Resource not found.");
export const validationError = (fields: Record<string, string>) =>
  new AppError(400, "VALIDATION_ERROR", "The request is not valid.", { fields });

/** Express 4 does not catch rejected promises; route them to the error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound());

/** One JSON error envelope for every failure; never leaks stack traces or SQL. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "The request body is not valid JSON.", details: {} } });
    return;
  }
  console.error("Unhandled error:", err instanceof Error ? err.message : err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong.", details: {} } });
};
