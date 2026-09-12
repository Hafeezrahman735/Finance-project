// Empty by default: the Vite dev server proxies /api to the API (vite.config.js),
// so the app is same-origin. Set VITE_API_URL only for a separately hosted API.
export const BASE_URL = import.meta.env.VITE_API_URL ?? "";

// /api/v1 conventions: docs/architecture.md. Amounts are integer minor units;
// lists are { data, nextCursor }. utils/api.js adapts them for the current pages.
export const API_PATHS = {
  AUTH: {
    LOGIN: "/api/v1/auth/login",
    REGISTER: "/api/v1/auth/register",
    ME: "/api/v1/auth/me",
  },
  ORGANIZATIONS: {
    LIST: "/api/v1/organizations",
    CURRENT: "/api/v1/organizations/current",
  },
  ACCOUNTS: {
    LIST: "/api/v1/accounts",
  },
  DASHBOARD: {
    GET_DATA: "/api/v1/dashboard",
  },
  BANK_ACCOUNTS: { LIST: "/api/v1/bank-accounts" },
  IMPORTS: {
    LIST: "/api/v1/imports",
    ONE: (id) => `/api/v1/imports/${id}`,
    MAPPING: (id) => `/api/v1/imports/${id}/mapping`,
    COMMIT: (id) => `/api/v1/imports/${id}/commit`,
  },
  RULES: { LIST: "/api/v1/rules", ONE: (id) => `/api/v1/rules/${id}` },
  TRANSACTIONS: {
    LIST: "/api/v1/transactions",
    ONE: (id) => `/api/v1/transactions/${id}`,
    REVERSE: (id) => `/api/v1/transactions/${id}/reverse`,
    EXPORT: "/api/v1/transactions/export.xlsx",
  },
};
