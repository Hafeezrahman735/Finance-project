import axios from "axios";
import { BASE_URL } from "./apiPaths";
import { refreshAccessToken, session } from "../lib/session";

/**
 * Authenticated client for /api/v1. On a 401 whose code says the access token
 * is stale (`token_expired` / `invalid_token`) it refreshes once through the
 * httpOnly cookie and retries the original request; any other 401, or a failed
 * refresh, clears the token and sends the visitor to /login.
 */
const axiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  withCredentials: true,
  headers: { "content-type": "application/json", Accept: "application/json" },
});

axiosInstance.interceptors.request.use((config) => {
  const accessToken = session.getToken();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

const REFRESHABLE = new Set(["token_expired", "invalid_token", "missing_token"]);

function toLogin() {
  session.clear();
  if (window.location.pathname !== "/login") window.location.href = "/login";
}

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;
    if (response?.status === 401 && config && !config._retried) {
      const code = response.data?.error?.code;
      if (REFRESHABLE.has(code) && session.getToken()) {
        try {
          await refreshAccessToken();
          config._retried = true;
          return axiosInstance(config);
        } catch {
          toLogin();
        }
      } else if (config.url && !config.url.includes("/auth/login")) {
        toLogin();
      }
    } else if (error.code === "ECONNABORTED") {
      console.error("request timeout, please try again");
    }
    return Promise.reject(error);
  },
);

export default axiosInstance;
