import User from "../Model/user.model.js";
import Product from "../Model/product.model.js";

export const getWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "wishlist",
      populate: { path: "seller", select: "name sellerProfile.shopName" },
    });
    return res.json({ items: user.wishlist });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const addToWishlist = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ message: "productId шаардлагатай" });
    const exists = await Product.exists({ _id: productId });
    if (!exists) return res.status(404).json({ message: "Бараа олдсонгүй" });

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { wishlist: productId } },
      { new: true },
    );
    return res.json({ wishlist: updated.wishlist });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { wishlist: req.params.productId } },
      { new: true },
    );
    return res.json({ wishlist: updated.wishlist });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
