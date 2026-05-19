import Notification from "../Model/notification.model.js";

export const listMine = async (req, res) => {
  try {
    const { unread, limit = 30 } = req.query;
    const filter = { user: req.user._id };
    if (unread === "true") filter.read = false;
    const items = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(100, Number(limit)));
    const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
    return res.json({ items, unreadCount });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const markRead = async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, user: req.user._id },
      { read: true },
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, read: false },
      { read: true },
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const remove = async (req, res) => {
  try {
    await Notification.deleteOne({ _id: req.params.id, user: req.user._id });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
