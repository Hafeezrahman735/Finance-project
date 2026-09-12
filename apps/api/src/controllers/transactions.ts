import type { Request, Response } from "express";
import type { Model, Types } from "mongoose";
import { z } from "zod";
import { NotFoundError } from "../lib/errors.js";
import { sendWorkbook } from "../lib/excel.js";
import { body } from "../middleware/validate.js";
import { Expense } from "../models/Expense.js";
import { Income } from "../models/Income.js";

/**
 * One controller for both collections. The old incomeController and
 * expenseController were near-duplicates (CEO review, Section 5); the only
 * differences are the label field name and the export filename.
 *
 * Every read and write is scoped by the authenticated user's id. The old
 * update/delete used findByIdAndUpdate(req.params.id) with no owner filter,
 * so any user could edit any row by guessing an id.
 */
const dateInput = z.union([z.string().min(1), z.date()]).transform((v) => new Date(v)).refine((d) => !Number.isNaN(d.getTime()), "must be a valid date");

const base = {
  amount: z.coerce.number().positive("must be greater than 0"),
  date: dateInput,
  icon: z.string().max(64).optional(),
};

export const incomeSchema = z.object({ source: z.string().trim().min(1, "is required").max(200), ...base });
export const expenseSchema = z.object({ category: z.string().trim().min(1, "is required").max(200), ...base });
export const incomePatchSchema = incomeSchema.partial();
export const expensePatchSchema = expenseSchema.partial();

type Kind = "income" | "expense";

/** Common shape of both collections; the label field differs by kind. */
interface TxnDoc {
  userId: Types.ObjectId;
  amount: number;
  date: Date;
  icon?: string | null;
  source?: string;
  category?: string;
}

const meta = {
  income: { Model: Income as unknown as Model<TxnDoc>, label: "source", sheet: "Income", file: "income_details.xlsx" },
  expense: { Model: Expense as unknown as Model<TxnDoc>, label: "category", sheet: "Expense", file: "expense_details.xlsx" },
} as const;

export function transactionsController(kind: Kind) {
  const { Model, label, sheet, file } = meta[kind];
  const userId = (req: Request) => req.user!._id;

  return {
    async create(req: Request, res: Response) {
      const data = body<typeof incomeSchema | typeof expenseSchema>(req);
      const doc = await Model.create({ ...data, userId: userId(req) });
      res.status(201).json(doc);
    },

    async list(req: Request, res: Response) {
      const docs = await Model.find({ userId: userId(req) }).sort({ date: -1 });
      res.json(docs);
    },

    async update(req: Request, res: Response) {
      const data = body<typeof incomePatchSchema | typeof expensePatchSchema>(req);
      const doc = await Model.findOneAndUpdate({ _id: req.params.id, userId: userId(req) }, data, { new: true, runValidators: true });
      if (!doc) throw new NotFoundError(`${sheet} not found`, `${kind}_not_found`);
      res.json(doc);
    },

    async remove(req: Request, res: Response) {
      const doc = await Model.findOneAndDelete({ _id: req.params.id, userId: userId(req) });
      if (!doc) throw new NotFoundError(`${sheet} not found`, `${kind}_not_found`);
      res.json({ message: `${sheet} deleted successfully` });
    },

    async downloadExcel(req: Request, res: Response) {
      const docs = await Model.find({ userId: userId(req) }).sort({ date: -1 }).lean();
      const rows = docs.map((d) => ({
        label: d[label],
        amount: d.amount,
        date: d.date,
      }));
      await sendWorkbook(
        res,
        file,
        sheet,
        [
          { header: label === "source" ? "Source" : "Category", key: "label", width: 28 },
          { header: "Amount", key: "amount", width: 14 },
          { header: "Date", key: "date", width: 20 },
        ],
        rows,
      );
    },
  };
}
