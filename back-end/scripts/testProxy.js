#!/usr/bin/env node
/**
 * Quick proxy verification script.
 *
 * Usage:
 *   node scripts/testProxy.js http://user:pass@host:port
 *   node scripts/testProxy.js http://user:pass@host:port https://apiweb.garage.mn/api/plate?platenumber=8083СЭН
 *
 * Behaviour:
 *   1. Sends GET to https://api.ipify.org through the proxy → confirms exit IP differs
 *   2. If a 2nd arg is given, also calls that URL through the proxy and prints status + body head
 *
 * Exit codes:
 *   0  — proxy reachable, returned non-server-error status
 *   1  — proxy unreachable or upstream 5xx
 *   2  — bad arguments
 */

import "dotenv/config";
import { probeProxy } from "../Service/proxyPool.service.js";

const [, , proxyUrl, targetUrl] = process.argv;

if (!proxyUrl) {
  console.error("Usage: node scripts/testProxy.js <proxyUrl> [targetUrl]");
  process.exit(2);
}

const redact = (u) => u.replace(/:[^:@\/]+@/, ":***@");

(async () => {
  console.log(`\n  Proxy:  ${redact(proxyUrl)}`);

  // 1. Show the exit IP
  try {
    console.log(`  Step 1: ipify echo …`);
    const ip = await probeProxy(proxyUrl, "https://api.ipify.org?format=json");
    console.log(`          status=${ip.status}  body=${ip.body.trim()}`);
    if (!ip.ok) {
      console.error("          ✗ ipify returned non-OK — proxy unreachable");
      process.exit(1);
    }
  } catch (e) {
    console.error(`          ✗ ${e.message}`);
    process.exit(1);
  }

  // 2. Optional: hit the real upstream
  if (targetUrl) {
    try {
      console.log(`  Step 2: target ${targetUrl} …`);
      const r = await probeProxy(proxyUrl, targetUrl);
      console.log(`          status=${r.status}`);
      console.log(`          body[0..200]=${r.body.slice(0, 200)}${r.body.length > 200 ? "…" : ""}`);
      if (r.status >= 500) {
        console.error("          ✗ upstream 5xx");
        process.exit(1);
      }
    } catch (e) {
      console.error(`          ✗ ${e.message}`);
      process.exit(1);
    }
  }

  console.log(`\n  ✓ Proxy works.\n`);
  process.exit(0);
})();
