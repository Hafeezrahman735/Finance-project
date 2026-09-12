import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Config } from "../config.js";
import { AuthenticationError, ConflictError, NotFoundError } from "../lib/errors.js";
import { body } from "../middleware/validate.js";
import { User, toUserDTO } from "../models/User.js";

export const registerSchema = z.object({
  fullName: z.string().trim().min(1, "is required").max(120),
  email: z.string().trim().email("must be a valid email address"),
  password: z.string().min(8, "must be at least 8 characters").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().email("must be a valid email address"),
  password: z.string().min(1, "is required"),
});

export function authController(config: Pick<Config, "JWT_SECRET" | "JWT_EXPIRES_IN">) {
  const sign = (id: string) =>
    jwt.sign({ id }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });

  return {
    async register(req: Request, res: Response) {
      const { fullName, email, password } = body<typeof registerSchema>(req);
      if (await User.exists({ email: email.toLowerCase() })) {
        throw new ConflictError("An account with this email already exists", "email_taken");
      }
      const user = await User.create({ fullName, email, password });
      res.status(201).json({ id: String(user._id), user: toUserDTO(user), token: sign(String(user._id)) });
    },

    async login(req: Request, res: Response) {
      const { email, password } = body<typeof loginSchema>(req);
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user || !(await user.comparePassword(password))) {
        throw new AuthenticationError("Invalid email or password", "invalid_credentials");
      }
      res.json({ id: String(user._id), user: toUserDTO(user), token: sign(String(user._id)) });
    },

    async me(req: Request, res: Response) {
      if (!req.user) throw new NotFoundError("User not found", "user_not_found");
      res.json(toUserDTO(req.user));
    },
  };
}
