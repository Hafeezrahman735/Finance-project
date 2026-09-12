import bcrypt from "bcryptjs";
import mongoose, { type HydratedDocument, type InferSchemaType, type Model } from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
  },
  { timestamps: true },
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

export interface UserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}

userSchema.methods.comparePassword = async function (this: { password: string }, candidate: string) {
  return bcrypt.compare(candidate, this.password);
};

export type UserSchema = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserSchema, UserMethods>;
type UserModel = Model<UserSchema, object, UserMethods>;

export const User = mongoose.model<UserSchema, UserModel>("User", userSchema);

/** Public shape. Never return the document itself: it carries the bcrypt hash. */
export interface UserDTO {
  id: string;
  fullName: string;
  email: string;
  createdAt?: string;
}

export function toUserDTO(user: UserDoc | (UserSchema & { _id: mongoose.Types.ObjectId; createdAt?: Date })): UserDTO {
  return {
    id: String(user._id),
    fullName: user.fullName,
    email: user.email,
    ...(user.createdAt ? { createdAt: user.createdAt.toISOString() } : {}),
  };
}
