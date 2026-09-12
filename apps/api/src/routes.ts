import { Router } from "express";
import type { Config } from "./config.js";
import { authController, loginSchema, registerSchema } from "./controllers/auth.js";
import { getDashboard } from "./controllers/dashboard.js";
import { expensePatchSchema, expenseSchema, incomePatchSchema, incomeSchema, transactionsController } from "./controllers/transactions.js";
import { protect } from "./middleware/auth.js";
import { validateBody } from "./middleware/validate.js";

/**
 * Route table. Paths are the ORIGINAL tutorial paths so the web app keeps
 * working unchanged in this PR; the REST conventions in docs/architecture.md
 * (plural nouns, sub-resource actions, cursor lists) arrive with the Prisma
 * PR together with the new Transactions page.
 *
 * Two compatibility fixes: DELETE /income/:id is added because the web app
 * calls it (the old API only had /income/delete/:id, so income delete was
 * broken), and the Excel routes are registered in both casings the web app
 * uses.
 */
export function buildRouter(config: Config): Router {
  const auth = authController(config);
  const income = transactionsController("income");
  const expense = transactionsController("expense");
  const guard = protect(config.JWT_SECRET);

  const router = Router();

  router.post("/auth/register", validateBody(registerSchema), auth.register);
  router.post("/auth/login", validateBody(loginSchema), auth.login);
  router.get("/auth/getUser", guard, auth.me);

  router.get("/dashboard", guard, getDashboard);

  router.post("/income/addIncome", guard, validateBody(incomeSchema), income.create);
  router.get("/income/getIncome", guard, income.list);
  router.patch("/income/updateIncome/:id", guard, validateBody(incomePatchSchema), income.update);
  router.delete("/income/delete/:id", guard, income.remove);
  router.get("/income/downloadexcel", guard, income.downloadExcel);
  router.delete("/income/:id", guard, income.remove);

  router.post("/expense/addExpense", guard, validateBody(expenseSchema), expense.create);
  router.get("/expense/get", guard, expense.list);
  router.patch("/expense/updateExpense/:id", guard, validateBody(expensePatchSchema), expense.update);
  router.get("/expense/downloadexcel", guard, expense.downloadExcel);
  router.get("/expense/downloadExcel", guard, expense.downloadExcel);
  router.delete("/expense/:id", guard, expense.remove);

  return router;
}
