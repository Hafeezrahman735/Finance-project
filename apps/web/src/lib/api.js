import axiosInstance from "../utils/axiosinstance";
import { API_PATHS } from "../utils/apiPaths";

/**
 * Thin client over /api/v1 (docs/api.md). Amounts are integer minor units;
 * lists are { data, nextCursor }. Errors carry `error.code` (utils/axiosinstance
 * handles 401 → /login globally).
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
};

export const accounts = {
  list: () => axiosInstance.get(API_PATHS.ACCOUNTS.LIST).then((r) => r.data.data),
};

export const dashboard = {
  get: () => axiosInstance.get(API_PATHS.DASHBOARD.GET_DATA).then((r) => r.data),
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
