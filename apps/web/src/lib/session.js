import axios from "axios";
import { API_PATHS, BASE_URL } from "../utils/apiPaths";

/**
 * Access-token storage plus the refresh call (plan 1.1). The refresh token
 * itself lives in an httpOnly cookie scoped to /api/v1/auth; the browser sends
 * it on its own, so this module never sees it. A bare axios client is used
 * (not utils/axiosinstance) so a refresh can never trigger another refresh.
 */
const TOKEN_KEY = "token";
const bare = axios.create({ baseURL: BASE_URL, timeout: 10000, withCredentials: true });

export const session = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

let inFlight = null;

/** Rotate the refresh cookie and store the new access token. One request at a time: concurrent callers share it. */
export function refreshAccessToken() {
  if (!inFlight) {
    inFlight = bare
      .post(API_PATHS.AUTH.REFRESH)
      .then((r) => {
        session.setToken(r.data.token);
        return r.data;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Revoke the session server-side (best effort) and drop the access token. */
export async function signOut() {
  try {
    await bare.post(API_PATHS.AUTH.LOGOUT);
  } catch {
    // The cookie may already be gone; local state is cleared regardless.
  }
  session.clear();
}
