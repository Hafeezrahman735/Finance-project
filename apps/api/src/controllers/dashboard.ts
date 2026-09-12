import type { Request, Response } from "express";
import { Types } from "mongoose";
import { Expense } from "../models/Expense.js";
import { Income } from "../models/Income.js";

const DAY = 24 * 60 * 60 * 1000;

async function total(Model: typeof Income | typeof Expense, userId: Types.ObjectId): Promise<number> {
  const [row] = await Model.aggregate<{ total: number }>([{ $match: { userId } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  return row?.total ?? 0;
}

/**
 * Response shape is unchanged from the original dashboard controller so the
 * Home page keeps working. "Last N days" is still wall-clock UTC here; the
 * Postgres PR introduces DATE columns and an organization timezone (ADR 0004,
 * eng review finding F5).
 */
export async function getDashboard(req: Request, res: Response) {
  const userId = req.user!._id as Types.ObjectId;

  const [totalIncome, totalExpense, last60DaysIncome, last30DaysExpense, recentIncome, recentExpense] = await Promise.all([
    total(Income, userId),
    total(Expense, userId),
    Income.find({ userId, date: { $gte: new Date(Date.now() - 60 * DAY) } }).sort({ date: -1 }).lean(),
    Expense.find({ userId, date: { $gte: new Date(Date.now() - 30 * DAY) } }).sort({ date: -1 }).lean(),
    Income.find({ userId }).sort({ date: -1 }).limit(5).lean(),
    Expense.find({ userId }).sort({ date: -1 }).limit(5).lean(),
  ]);

  const sum = (rows: { amount: number }[]) => rows.reduce((acc, r) => acc + r.amount, 0);

  const recentTransactions = [
    ...recentIncome.map((t) => ({ ...t, type: "income" as const })),
    ...recentExpense.map((t) => ({ ...t, type: "expense" as const })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  res.json({
    totalBalance: totalIncome - totalExpense,
    totalIncome,
    totalExpense,
    last30DaysExpense: { total: sum(last30DaysExpense), transaction: last30DaysExpense },
    last60DaysIncome: { total: sum(last60DaysIncome), transaction: last60DaysIncome },
    recentTransactions,
  });
}
