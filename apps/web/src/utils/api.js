import { toMinor } from "@ledgeriq/shared";
import axiosInstance from "./axiosinstance";
import { API_PATHS } from "./apiPaths";

/**
 * Adapter between the ledger API (/api/v1, minor units, {data, nextCursor}
 * lists) and the current pages, which still think in "income"/"expense" rows
 * with dollar amounts. The Transactions page rewrite (Slice 1, lane 1.3)
 * replaces these pages and this file with it.
 */

const major = (minor) => minor / 100;

export function toLegacyRow(t) {
  return {
    _id: t.id,
    version: t.version,
    date: t.date,
    amount: major(t.amountMinor),
    type: t.direction === "in" ? "income" : "expense",
    source: t.memo || t.categoryName,
    category: t.uncategorized ? t.memo || "Uncategorized" : t.categoryName,
    memo: t.memo,
    categoryName: t.categoryName,
    uncategorized: t.uncategorized,
    icon: null,
  };
}

let accountsCache = null;
export async function getAccounts() {
  if (!accountsCache) {
    const res = await axiosInstance.get(API_PATHS.ACCOUNTS.LIST);
    accountsCache = res.data.data;
  }
  return accountsCache;
}

async function accountIdFor({ direction, category }) {
  const accounts = await getAccounts();
  if (direction === "in") return accounts.find((a) => a.systemKey === "sales")?.id;
  const wanted = (category || "").trim().toLowerCase();
  const match = accounts.find((a) => a.type === "EXPENSE" && a.name.toLowerCase() === wanted);
  return match?.id; // undefined → API defaults to Uncategorized, memo keeps the typed category
}

export async function listTransactions(direction) {
  const res = await axiosInstance.get(API_PATHS.TRANSACTIONS.LIST, { params: { direction, limit: 200 } });
  return res.data.data.map(toLegacyRow);
}

export async function createTransaction({ direction, amount, date, memo, category }) {
  const amountMinor = toMinor(String(amount));
  const accountId = await accountIdFor({ direction, category });
  const res = await axiosInstance.post(API_PATHS.TRANSACTIONS.LIST, {
    direction,
    amountMinor,
    date,
    memo: memo || category || "",
    ...(accountId ? { accountId } : {}),
  });
  return toLegacyRow(res.data);
}

export async function updateTransaction(id, version, { amount, date, memo }) {
  const res = await axiosInstance.patch(API_PATHS.TRANSACTIONS.ONE(id), {
    version,
    ...(amount !== undefined && amount !== "" ? { amountMinor: toMinor(String(amount)) } : {}),
    ...(date ? { date } : {}),
    ...(memo !== undefined ? { memo } : {}),
  });
  return toLegacyRow(res.data);
}

export async function deleteTransaction(id) {
  await axiosInstance.delete(API_PATHS.TRANSACTIONS.ONE(id));
}

export async function getDashboard() {
  const { data } = await axiosInstance.get(API_PATHS.DASHBOARD.GET_DATA);
  const rows30 = data.last30Days.transactions.map(toLegacyRow);
  return {
    totalBalance: major(data.totalBalanceMinor),
    totalIncome: major(data.totalIncomeMinor),
    totalExpense: major(data.totalExpenseMinor),
    cashOnHand: major(data.cashOnHandMinor),
    uncategorizedCount: data.uncategorizedCount,
    last30DaysExpense: { total: major(data.last30Days.expenseMinor), transaction: rows30.filter((r) => r.type === "expense") },
    last60DaysIncome: { total: major(data.last60DaysIncome.totalMinor), transaction: data.last60DaysIncome.transactions.map(toLegacyRow) },
    recentTransactions: data.recentTransactions.map(toLegacyRow),
  };
}

/** Fetches the .xlsx export with the auth header and triggers a browser download. */
export async function downloadExport(direction) {
  const res = await axiosInstance.get(API_PATHS.TRANSACTIONS.EXPORT, { params: { direction }, responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions-${direction}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
