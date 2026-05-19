/**
 * Garage.mn vehicle provider adapter.
 *
 * Upstream:   https://apiweb.garage.mn/api/plate?platenumber=<X>
 * Response:   { success: true, data: { carid, carname, manuname, modelname,
 *                                       motorcode, motortype, platenumber,
 *                                       carimage: { imgurl400, imgurl800 } } }
 *
 * Env knobs:
 *   GARAGE_API_URL   — override base URL (default: apiweb.garage.mn)
 *   GARAGE_API_KEY   — optional X-API-Key header
 */

const BASE_URL = (process.env.GARAGE_API_URL || "https://apiweb.garage.mn/api/plate").replace(/\/$/, "");
const PLATE_RX = /^[0-9]{3,4}[Ѐ-ӿÀ-ʯA-Z]{2,4}$/i;

const garageAdapter = {
  name: "garage",
  displayName: "Garage.mn",

  normalizePlate(plate) {
    return String(plate || "").toUpperCase().replace(/\s+/g, "");
  },

  isPlateValid(plate) {
    return PLATE_RX.test(this.normalizePlate(plate));
  },

  buildRequest(plate) {
    return {
      url: `${BASE_URL}?platenumber=${encodeURIComponent(plate)}`,
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "HiCar/1.0 (+https://hicar.mn)",
        ...(process.env.GARAGE_API_KEY ? { "X-API-Key": process.env.GARAGE_API_KEY } : {}),
      },
    };
  },

  parseResponse(json) {
    if (!json || json.success === false || !json.data) {
      const e = new Error(json?.message || "Vehicle not found");
      e.code = "NOT_FOUND";
      throw e;
    }
    const d = json.data;
    const images = [];
    if (d.carimage?.imgurl800) images.push(d.carimage.imgurl800);
    else if (d.carimage?.imgurl400) images.push(d.carimage.imgurl400);

    return {
      externalId:  d.carid ?? null,
      manuname:    String(d.manuname || "").trim().toUpperCase(),
      modelname:   String(d.modelname || "").trim(),  // generation parsing happens in normalizer
      motorcode:   String(d.motorcode || "").trim().toUpperCase(),
      motortype:   String(d.motortype || "").trim(),
      carname:     String(d.carname || "").trim(),
      platenumber: String(d.platenumber || "").trim(),
      imageUrls:   images,
    };
  },
};

export default garageAdapter;
