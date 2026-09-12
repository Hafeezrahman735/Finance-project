import mongoose, { type InferSchemaType } from "mongoose";

// Amounts stay floating `Number` in this PR to remain wire-compatible with the
// web app; the Prisma/Postgres PR moves money to integer minor units (ADR 0002).
const incomeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    icon: { type: String },
    source: { type: String, required: true, trim: true, maxlength: 200 },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

export type IncomeSchema = InferSchemaType<typeof incomeSchema>;
export const Income = mongoose.model("Income", incomeSchema);
