const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
const TOKEN_KEY = "hicar-token";

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const getToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
};
export const setToken = (t: string | null) => {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

// ── Refresh-on-401 plumbing ────────────────────────────────────────
let refreshPromise: Promise<string | null> | null = null;
let onSessionLost: (() => void) | null = null;

/** Allow the app to register a callback for "session is gone, log the user out". */
export const onAuthExpired = (cb: () => void) => { onSessionLost = cb; };

/** Try to refresh the access token using the httpOnly cookie. Returns new token or null. */
const attemptRefresh = async (): Promise<string | null> => {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.token) {
        setToken(data.token);
        return data.token as string;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
};

async function request<T>(path: string, opts: RequestInit = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as Record<string, string> || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
    credentials: "include",
  });

  // Attempt one-time refresh on 401 if we have a refresh cookie (and weren't refreshing already)
  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    const newToken = await attemptRefresh();
    if (newToken) return request<T>(path, opts, false);
    // Refresh failed → session is gone
    setToken(null);
    onSessionLost?.();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message || `HTTP ${res.status}`, res.status, data);
  return data as T;
}

export const api = {
  get: <T,>(p: string) => request<T>(p),
  post: <T,>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T,>(p: string, body?: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T,>(p: string, body?: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T,>(p: string) => request<T>(p, { method: "DELETE" }),

  /** Manually trigger refresh — used on app boot to revive sessions. */
  refresh: attemptRefresh,

  /** Server logout — clears refresh cookie. */
  logout: async () => {
    try { await fetch(`${BASE}/auth/logout`, { method: "POST", credentials: "include" }); } catch {}
    setToken(null);
  },

  uploadImage: async (file: File): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append("image", file);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/upload`, {
      method: "POST", headers, body: fd, credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.message || `HTTP ${res.status}`, res.status, data);
    return data;
  },
};
