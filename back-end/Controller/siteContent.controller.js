import {
  loadSiteContent, updateSiteContent, getCategoriesWithCounts,
} from "../Service/siteContent.service.js";

/** Public read — homepage chrome + admin editor preview. */
export const getSiteContent = async (_req, res) => {
  try {
    const content = await loadSiteContent();
    // Cache on the edge for 60s — content is admin-rare-write, high-read.
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.json({ content });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Public read — homepage's "what categories to show + how many?" call. */
export const getHomepageCategories = async (_req, res) => {
  try {
    const items = await getCategoriesWithCounts();
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.json({ categories: items });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** Admin write — protected upstream by adminOnly middleware. */
export const patchSiteContent = async (req, res) => {
  try {
    const { categories, hero } = req.body || {};
    if (categories !== undefined && !Array.isArray(categories)) {
      return res.status(400).json({ message: "categories array биш байна" });
    }
    if (hero !== undefined && (typeof hero !== "object" || hero === null)) {
      return res.status(400).json({ message: "hero object байх ёстой" });
    }
    const saved = await updateSiteContent({
      categories, hero, updatedBy: req.user._id,
    });
    return res.json({ content: saved });
  } catch (err) {
    // updateSiteContent throws ATTRIBUTE_SCHEMA_INVALID with a `details`
    // array when one or more attributesSchema rows are malformed. The
    // frontend renders this list inline so the admin sees exactly which
    // row failed.
    if (err.code === "ATTRIBUTE_SCHEMA_INVALID") {
      return res.status(400).json({
        code: err.code,
        message: "Шинж чанарын тодорхойлолтод алдаа байна",
        details: err.details,
      });
    }
    return res.status(400).json({ message: err.message });
  }
};
