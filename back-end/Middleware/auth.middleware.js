import jwt from "jsonwebtoken";
import User from "../Model/user.model.js";

export const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Token дутуу байна" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "Хэрэглэгч олдсонгүй" });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token буруу байна" });
  }
};

export const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin эрх шаардлагатай" });
  }
  next();
};

export const sellerOrAdmin = (req, res, next) => {
  if (!["seller", "admin"].includes(req.user?.role)) {
    return res.status(403).json({ message: "Seller эсвэл Admin эрх шаардлагатай" });
  }
  next();
};

export const approvedSeller = (req, res, next) => {
  if (req.user?.role === "admin") return next();
  if (req.user?.role !== "seller" || req.user?.sellerStatus !== "approved") {
    return res.status(403).json({ message: "Зөвхөн зөвшөөрөгдсөн seller үйлдэл хийнэ" });
  }
  next();
};
