/**
 * Server-side proxy to the HiCar Data Platform (`/api/v1`).
 *
 * The data platform runs as a separate process (bounded context) and is NOT
 * itself auth-guarded. Routing the browser through this same-origin proxy
 * avoids CORS, keeps the DP URL server-side, and — critically — gates every
 * call on admin role: the caller's bearer token is verified against the legacy
 * API's `/auth/me`, and non-admins are rejected before anything reaches the DP.
 */

import { NextRequest, NextResponse } from "next/server";

const DP_BASE = process.env.DP_API_URL || "http://localhost:5100/api/v1";
const LEGACY_API =
  process.env.LEGACY_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

/**
 * Resolve the caller from their bearer token via the legacy API and require the
 * admin role. Returns null when authorized, or a ready-to-send error response.
 */
async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const auth = req.headers.get("authorization");
  if (!auth) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", message: "Нэвтрэх шаардлагатай" },
      { status: 401 },
    );
  }
  try {
    const meRes = await fetch(`${LEGACY_API}/auth/me`, {
      headers: { authorization: auth },
      cache: "no-store",
    });
    if (!meRes.ok) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHENTICATED", message: "Хүчингүй эсвэл хугацаа дууссан сесс" },
        { status: 401 },
      );
    }
    const data = (await meRes.json().catch(() => ({}))) as { user?: { role?: string } };
    if (data.user?.role !== "admin") {
      return NextResponse.json(
        { ok: false, code: "FORBIDDEN", message: "Зөвхөн админд зөвшөөрөгдөнө" },
        { status: 403 },
      );
    }
    return null;
  } catch {
    return NextResponse.json(
      { ok: false, code: "AUTH_UNREACHABLE", message: "Эрх шалгах API хүрэхгүй байна" },
      { status: 502 },
    );
  }
}

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  const target = `${DP_BASE}/${path.join("/")}${req.nextUrl.search}`;

  // Pass through the original content-type so multipart boundaries survive
  // (CSV/Excel uploads), plus the caller's auth token.
  const headers: Record<string, string> = {};
  const ct = req.headers.get("content-type");
  const auth = req.headers.get("authorization");
  if (ct) headers["content-type"] = ct;
  if (auth) headers["authorization"] = auth;

  const init: RequestInit = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    // arrayBuffer works for JSON and binary/multipart alike.
    init.body = await req.arrayBuffer();
  }

  try {
    const resp = await fetch(target, init);
    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "content-type": resp.headers.get("content-type") || "application/json" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, code: "DP_UNREACHABLE", message: "Data platform хүрэхгүй байна" },
      { status: 502 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { path } = await ctx.params;
  return forward(req, path);
}
