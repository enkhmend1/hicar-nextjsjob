import Review from "../Model/review.model.js";
import Product from "../Model/product.model.js";
import Order from "../Model/order.model.js";
import mongoose from "mongoose";

/** Aggregate average rating + count for a product and persist on Product doc. */
const recomputeProductRating = async (productId) => {
  const agg = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  const avg = agg[0]?.avg ?? 0;
  const count = agg[0]?.count ?? 0;
  await Product.updateOne(
    { _id: productId },
    { $set: { rating: Math.round(avg * 10) / 10, ratingCount: count } },
  );
};

/** GET /api/products/:id/reviews */
export const listReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ product: req.params.id })
      .populate("user", "name")
      .sort({ createdAt: -1 });
    return res.json({ reviews });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** POST /api/products/:id/reviews — protect required */
export const createReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const productId = req.params.id;
    const r = Number(rating);
    if (!r || r < 1 || r > 5) {
      return res.status(400).json({ message: "Rating 1-5 байх ёстой" });
    }

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Бараа олдсонгүй" });

    // Verified-purchase check
    const verifiedPurchase = !!(await Order.exists({
      user: req.user._id,
      "items.product": productId,
      status: { $in: ["paid", "processing", "shipped", "delivered"] },
    }));

    try {
      const review = await Review.create({
        product: productId, user: req.user._id,
        rating: r, comment: (comment || "").trim(), verifiedPurchase,
      });
      await recomputeProductRating(productId);
      const populated = await review.populate("user", "name");
      return res.status(201).json({ review: populated });
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ message: "Та энэ бараанд аль хэдийн review бичсэн байна. Засаарай." });
      }
      throw e;
    }
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/** PUT /api/products/:id/reviews — protect, own review */
export const updateReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const productId = req.params.id;
    const r = Number(rating);
    if (!r || r < 1 || r > 5) {
      return res.status(400).json({ message: "Rating 1-5 байх ёстой" });
    }
    const review = await Review.findOne({ product: productId, user: req.user._id });
    if (!review) return res.status(404).json({ message: "Review олдсонгүй" });
    review.rating = r;
    review.comment = (comment || "").trim();
    await review.save();
    await recomputeProductRating(productId);
    return res.json({ review });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/** DELETE /api/products/:id/reviews — own OR admin */
export const deleteReview = async (req, res) => {
  try {
    const productId = req.params.id;
    const filter = { product: productId };
    if (req.user.role !== "admin") filter.user = req.user._id;
    const review = await Review.findOneAndDelete(filter);
    if (!review) return res.status(404).json({ message: "Review олдсонгүй" });
    await recomputeProductRating(productId);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
