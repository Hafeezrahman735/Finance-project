import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";
import { ValidationError } from "../lib/errors.js";

declare module "express-serve-static-core" {
  interface Request {
    validated?: unknown;
  }
}

/** Parses req.body with a zod schema; failures reach the error handler as ZodError. */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.body === undefined || req.body === null) throw new ValidationError("Request body is missing");
    req.validated = schema.parse(req.body);
    next();
  };
}

export function body<T extends ZodTypeAny>(req: Request): z.infer<T> {
  return req.validated as z.infer<T>;
}
