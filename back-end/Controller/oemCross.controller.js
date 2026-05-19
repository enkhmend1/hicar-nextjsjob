import { lookupCross, expandOemBag, upsertCross, removeCross, listCross } from "../Service/oemCross.service.js";

/** GET /api/oem/cross/:oem  — public-ish (read-only) */
export const lookup = async (req, res) => {
  const row = await lookupCross(req.params.oem);
  if (!row) return res.status(404).json({ message: "OEM олдсонгүй" });
  return res.json({ row });
};

/** POST /api/oem/expand  body { oems: [..] } — returns the full equivalence cloud */
export const expand = async (req, res) => {
  const oems = Array.isArray(req.body?.oems) ? req.body.oems : [];
  const bag = await expandOemBag(oems);
  return res.json({ bag });
};

/** GET /api/oem/cross?q=&category=&limit=&skip= — admin */
export const list = async (req, res) => {
  const out = await listCross(req.query);
  return res.json(out);
};

/** POST /api/oem/cross — admin */
export const create = async (req, res) => {
  try {
    const item = await upsertCross(req.body, req.user._id);
    return res.status(201).json({ item });
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }
};

/** PUT /api/oem/cross/:id — admin (treats as upsert on primaryOem) */
export const update = async (req, res) => {
  try {
    const item = await upsertCross({ ...req.body, _id: req.params.id }, req.user._id);
    return res.json({ item });
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }
};

/** DELETE /api/oem/cross/:id — admin */
export const remove = async (req, res) => {
  await removeCross(req.params.id);
  return res.json({ ok: true });
};
