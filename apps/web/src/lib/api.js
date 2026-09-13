import axiosInstance from "../utils/axiosinstance";
import { API_PATHS } from "../utils/apiPaths";

/**
 * Thin client over /api/v1 (docs/api.md). Amounts are integer minor units;
 * lists are { data, nextCursor }. Errors carry `error.code` (utils/axiosinstance
 * refreshes a stale access token once, then falls back to /login).
 */

export function errorMessage(err, fallback = "Something went wrong") {
  return err?.response?.data?.message || err?.message || fallback;
}

export function errorCode(err) {
  return err?.response?.data?.error?.code;
}

export const auth = {
  login: (body) => axiosInstance.post(API_PATHS.AUTH.LOGIN, body).then((r) => r.data),
  register: (body) => axiosInstance.post(API_PATHS.AUTH.REGISTER, body).then((r) => r.data),
  me: () => axiosInstance.get(API_PATHS.AUTH.ME).then((r) => r.data),
  logoutAll: () => axiosInstance.post(API_PATHS.AUTH.LOGOUT_ALL).then((r) => r.data),
  forgotPassword: (email) => axiosInstance.post(API_PATHS.AUTH.FORGOT_PASSWORD, { email }).then((r) => r.data),
  resetPassword: (token, password) => axiosInstance.post(API_PATHS.AUTH.RESET_PASSWORD, { token, password }).then((r) => r.data),
  verifyEmail: (token) => axiosInstance.post(API_PATHS.AUTH.VERIFY_EMAIL, { token }).then((r) => r.data),
  resendVerification: () => axiosInstance.post(API_PATHS.AUTH.RESEND_VERIFICATION).then((r) => r.data),
};

export const accounts = {
  list: () => axiosInstance.get(API_PATHS.ACCOUNTS.LIST).then((r) => r.data.data),
};

export const dashboard = {
  get: () => axiosInstance.get(API_PATHS.DASHBOARD.GET_DATA).then((r) => r.data),
};

/** Weekly Money Brief (plan E8). `current` generates this week's on first read; `peek` reads without marking the first open. */
export const briefs = {
  current: () => axiosInstance.get(API_PATHS.BRIEFS.CURRENT, { timeout: 90000 }).then((r) => r.data),
  peek: () => axiosInstance.get(API_PATHS.BRIEFS.CURRENT, { params: { peek: 1 }, timeout: 90000 }).then((r) => r.data),
  regenerate: () => axiosInstance.post(API_PATHS.BRIEFS.REGENERATE, {}, { timeout: 90000 }).then((r) => r.data),
  email: () => axiosInstance.post(API_PATHS.BRIEFS.EMAIL).then((r) => r.data),
  list: () => axiosInstance.get(API_PATHS.BRIEFS.LIST).then((r) => r.data.data),
  get: (id) => axiosInstance.get(API_PATHS.BRIEFS.ONE(id)).then((r) => r.data.brief),
};

/** Deterministic metrics with ids and display strings (plan E1); cached server-side per day. */
export const metrics = {
  get: () => axiosInstance.get(API_PATHS.METRICS.GET).then((r) => r.data),
};

export const bankAccounts = {
  list: () => axiosInstance.get(API_PATHS.BANK_ACCOUNTS.LIST).then((r) => r.data.data),
  create: (body) => axiosInstance.post(API_PATHS.BANK_ACCOUNTS.LIST, body).then((r) => r.data),
};

export const imports = {
  list: () => axiosInstance.get(API_PATHS.IMPORTS.LIST).then((r) => r.data.data),
  get: (id) => axiosInstance.get(API_PATHS.IMPORTS.ONE(id)).then((r) => r.data),
  upload: (bankAccountId, file) => {
    const form = new FormData();
    form.append("bankAccountId", bankAccountId);
    form.append("file", file);
    return axiosInstance.post(API_PATHS.IMPORTS.LIST, form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 }).then((r) => r.data);
  },
  setMapping: (id, mapping) => axiosInstance.post(API_PATHS.IMPORTS.MAPPING(id), mapping, { timeout: 300000 }).then((r) => r.data),
  commit: (id, includeDuplicates = []) => axiosInstance.post(API_PATHS.IMPORTS.COMMIT(id), { includeDuplicates }, { timeout: 600000 }).then((r) => r.data),
};

export const rules = {
  list: () => axiosInstance.get(API_PATHS.RULES.LIST).then((r) => r.data.data),
  create: (body) => axiosInstance.post(API_PATHS.RULES.LIST, body).then((r) => r.data),
  remove: (id) => axiosInstance.delete(API_PATHS.RULES.ONE(id)).then((r) => r.data),
};

export const transactions = {
  list: (params) => axiosInstance.get(API_PATHS.TRANSACTIONS.LIST, { params }).then((r) => r.data),
  create: (body) => axiosInstance.post(API_PATHS.TRANSACTIONS.LIST, body).then((r) => r.data),
  /** Recategorize or split: `lines` = [{ accountId, amountMinor, channelId? }], must sum to the transaction amount. */
  recategorize: (id, version, lines) => axiosInstance.patch(API_PATHS.TRANSACTIONS.ONE(id), { version, lines }).then((r) => r.data),
  /** Manual entries only: returns the replacement transaction (new id). */
  correct: (id, version, patch) => axiosInstance.patch(API_PATHS.TRANSACTIONS.ONE(id), { version, ...patch }).then((r) => r.data),
  reverse: (id) => axiosInstance.post(API_PATHS.TRANSACTIONS.REVERSE(id)).then((r) => r.data),
  async exportXlsx(direction) {
    const res = await axiosInstance.get(API_PATHS.TRANSACTIONS.EXPORT, { params: direction ? { direction } : {}, responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${direction ?? "all"}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
