/**
 * Mock parts provider.
 *
 * Used when no real PARTS_PROVIDER is configured. Returns an empty OEM list
 * so the orchestrator falls back cleanly to (AI-only OEMs + DB search).
 *
 * This adapter intentionally never throws — keeps dev environments quiet.
 */

const mockAdapter = {
  name: "mock",
  displayName: "Mock (disabled)",
  configured: true,

  buildRequest() {
    // Will not actually be called — caller checks `configured` first and short-circuits.
    return { url: "about:blank", method: "GET" };
  },

  parseResponse() {
    return { oems: [], items: [], raw: { note: "mock adapter, no upstream call" } };
  },

  // Mock-specific helper invoked by the orchestrator instead of fetching.
  async runOffline() {
    return { oems: [], items: [], raw: { note: "mock adapter, no upstream call" } };
  },
};

export default mockAdapter;
