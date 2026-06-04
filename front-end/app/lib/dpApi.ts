/**
 * Thin client for the HiCar Data Platform, via the same-origin proxy at
 * /api/dp (see app/api/dp/[...path]/route.ts). Forwards the auth token so the
 * DP can enforce admin access once wired.
 */

import { useAuthStore } from "@/store";

const BASE = "/api/dp";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${BASE}/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string } & T;
  if (!res.ok) throw new Error(data?.message || `Data platform алдаа (${res.status})`);
  return data as T;
}

export const dpApi = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body: unknown) =>
    call<T>(path, { method: "POST", body: JSON.stringify(body) }),
};
