/**
 * PartsSouq adapter.
 *
 * PartsSouq does not publish a free public API. Two common integration paths:
 *
 *   (a) Official partner / reseller agreement → REST endpoints with API key.
 *       Set PARTSOUQ_BASE_URL + PARTSOUQ_API_KEY when granted.
 *
 *   (b) Search-page scraping (legally grey — only attempt with permission).
 *       Set PARTSOUQ_BASE_URL=https://partsouq.com and SCRAPE_MODE=true.
 *
 * This adapter ships with the public REST contract assumed by case (a).
 * Anyone replacing it for case (b) only needs to rewrite `parseResponse`.
 */

const BASE_URL = (process.env.PARTSOUQ_BASE_URL || "").replace(/\/$/, "");
const API_KEY  = process.env.PARTSOUQ_API_KEY || "";

const cleanCode = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");
const isOem = (s) => /^[A-Z0-9][A-Z0-9.\-/]{1,30}[A-Z0-9]$/i.test(s || "");

const partsouqAdapter = {
  name: "partsouq",
  displayName: "PartsSouq",
  configured: Boolean(BASE_URL && API_KEY),

  buildRequest({ vehicle, englishName, oemSeeds = [] }) {
    const params = new URLSearchParams({
      manufacturer: vehicle.manuname || "",
      model:        vehicle.modelname || "",
      ...(vehicle.generation ? { generation: vehicle.generation } : {}),
      ...(vehicle.motorcode  ? { engine: vehicle.motorcode } : {}),
      q:            englishName,
    });
    if (oemSeeds.length) params.set("oem", oemSeeds.slice(0, 10).join(","));

    return {
      url: `${BASE_URL}/v1/parts/search?${params.toString()}`,
      method: "GET",
      headers: {
        Accept:        "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "User-Agent":  "HiCar/1.0",
      },
    };
  },

  parseResponse(json) {
    // Assumed PartsSouq response shape (per documented partner API):
    //   { items: [{ oem, name, brand, price, image, url, … }], cursor }
    const rawItems = Array.isArray(json?.items) ? json.items : [];
    const oems = [...new Set(rawItems.map((i) => cleanCode(i.oem)).filter(isOem))];
    const items = rawItems.slice(0, 50).map((i) => ({
      oem:        cleanCode(i.oem),
      name:       String(i.name || ""),
      brand:      i.brand,
      price:      i.price != null ? String(i.price) : undefined,
      thumbnail:  i.image || i.thumbnail,
      sourceUrl:  i.url,
    }));
    return {
      oems,
      items,
      cursor: json?.cursor,
      raw: { count: rawItems.length },
    };
  },
};

export default partsouqAdapter;
