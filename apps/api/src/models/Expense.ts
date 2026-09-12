import mongoose, { type InferSchemaType } from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    icon: { type: String },
    category: { type: String, required: true, trim: true, maxlength: 200 },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

export type ExpenseSchema = InferSchemaType<typeof expenseSchema>;
export const Expense = mongoose.model("Expense", expenseSchema);
