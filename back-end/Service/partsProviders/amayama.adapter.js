/**
 * Amayama adapter.
 *
 * Amayama exposes a private partner API; integrators need to apply at
 * https://amayama.com/en/about for credentials. Set AMAYAMA_BASE_URL,
 * AMAYAMA_API_KEY (and optionally AMAYAMA_REGION) when granted.
 */

const BASE_URL = (process.env.AMAYAMA_BASE_URL || "").replace(/\/$/, "");
const API_KEY  = process.env.AMAYAMA_API_KEY  || "";
const REGION   = process.env.AMAYAMA_REGION   || "jp";

const cleanCode = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");
const isOem = (s) => /^[A-Z0-9][A-Z0-9.\-/]{1,30}[A-Z0-9]$/i.test(s || "");

const amayamaAdapter = {
  name: "amayama",
  displayName: "Amayama",
  configured: Boolean(BASE_URL && API_KEY),

  buildRequest({ vehicle, englishName, oemSeeds = [] }) {
    const body = {
      brand:        vehicle.manuname,
      model:        vehicle.modelname,
      chassis:      vehicle.generation || undefined,
      engine_code:  vehicle.motorcode || undefined,
      query:        englishName,
      oem_seeds:    oemSeeds.slice(0, 10),
      region:       REGION,
      limit:        50,
    };
    return {
      url: `${BASE_URL}/api/v2/parts/lookup`,
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${API_KEY}`,
        "Accept-Language": "en",
        "User-Agent":    "HiCar/1.0",
      },
      body: JSON.stringify(body),
    };
  },

  parseResponse(json) {
    const products = Array.isArray(json?.products) ? json.products : (json?.data ?? []);
    const oems = [...new Set(products.map((p) => cleanCode(p.oem_number || p.oem)).filter(isOem))];
    const items = products.slice(0, 50).map((p) => ({
      oem:       cleanCode(p.oem_number || p.oem),
      name:      String(p.title || p.name || ""),
      brand:     p.brand || p.manufacturer,
      price:     p.price?.amount ?? p.price,
      thumbnail: p.image_url || p.thumb,
      sourceUrl: p.url,
    }));
    return {
      oems,
      items,
      cursor: json?.next_cursor,
      raw: { count: products.length },
    };
  },
};

export default amayamaAdapter;
