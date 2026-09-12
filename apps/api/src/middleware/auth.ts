import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AuthenticationError } from "../lib/errors.js";
import { User, type UserDoc } from "../models/User.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: UserDoc;
  }
}

export function protect(jwtSecret: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) throw new AuthenticationError("Not authorized, no token", "missing_token");

    let payload: { id?: string };
    try {
      payload = jwt.verify(token, jwtSecret) as { id?: string };
    } catch {
      throw new AuthenticationError("Not authorized, token failed", "invalid_token");
    }
    const user = payload.id ? await User.findById(payload.id) : null;
    if (!user) throw new AuthenticationError("Not authorized, user no longer exists", "unknown_user");
    req.user = user;
    next();
  };
}
