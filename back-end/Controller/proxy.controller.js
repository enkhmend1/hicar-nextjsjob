/**
 * Proxy diagnostics — admin-only.
 *
 * Surfaces the live state of the proxy pool: which proxies are configured,
 * who's cooling down, success/fail counters, and when each was last used.
 * Useful for verifying that PROXY_URLS is actually rotating in production.
 */

import { proxyStats, proxyPoolEnabled, probeProxy } from "../Service/proxyPool.service.js";

export const listProxies = (_req, res) => {
  return res.json({
    enabled: proxyPoolEnabled,
    proxies: proxyStats(),
  });
};

/**
 * POST /api/admin/proxy/probe
 * Body: { url?, target? }
 *
 * If `url` is omitted, probes the upstream IP from the configured proxy pool
 * by sending one request to https://api.ipify.org through `pickProxy()`.
 * If `url` is supplied (ad-hoc proxy test), uses that proxy directly.
 *
 * Returns the body of the IP echo + which proxy was used. Cred-redacted.
 */
export const probe = async (req, res) => {
  try {
    const { url, target } = req.body || {};
    if (url) {
      const out = await probeProxy(url, target);
      return res.json({ mode: "ad-hoc", ...out });
    }
    // Pool-based probe: pick one, hit ipify, report exit IP
    const { pickProxy, reportProxyResult } = await import("../Service/proxyPool.service.js");
    const proxy = pickProxy();
    if (!proxy) return res.status(503).json({ message: "Proxy pool empty эсвэл бүгд cooled-down" });
    try {
      const res2 = await fetch(target || "https://api.ipify.org?format=json", {
        method: "GET",
        dispatcher: proxy.dispatcher,
        headers: { "User-Agent": "HiCar-ProxyProbe/1.0" },
      });
      const body = await res2.text();
      reportProxyResult(proxy, res2.ok);
      return res.json({
        mode: "pool",
        ok: res2.ok,
        status: res2.status,
        proxyUsed: proxy.url.replace(/:[^:@\/]+@/, ":***@"),
        body,
      });
    } catch (e) {
      reportProxyResult(proxy, false);
      throw e;
    }
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
