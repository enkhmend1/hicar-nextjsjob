import SupportTicket from "../Model/supportTicket.model.js";
import { enqueue, enqueueAdmins } from "../Service/notificationOutbox.service.js";

/**
 * Support ticket controller — general helpdesk / operator chat.
 *
 * Any authenticated user (buyer OR seller) opens a ticket and threads with
 * admin/operator about a problem. NOT order-scoped (that's disputes); this is
 * the catch-all support inbox.
 *
 * Authz model:
 *   • user endpoints  — `protect`, ownership = ticket.user === req.user._id
 *   • admin endpoints — `protect` + `adminOnly`
 * Every user handler 404s on a missing ticket and 403s on an ownership mismatch.
 *
 * Notifications go through the outbox `enqueue` / `enqueueAdmins` (durable
 * retry) using the "support_*" types. Failures are swallowed (.catch) so a
 * transient notification error never fails the ticket mutation itself.
 */

const MAX_SUBJECT = 140;
const MAX_TEXT = 2000;

/** Normalise + clamp a free-text body; returns "" for non-strings. */
const cleanText = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Coerce an images payload to an array of trimmed URL strings. */
const cleanImages = (v) =>
  Array.isArray(v)
    ? v.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : [];

/** Short subject snippet for notification bodies. */
const snip = (s, n = 80) => {
  const t = String(s || "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/* ──────────────────────────────────────────────────────────────────────
 * User — create
 * ────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/support   (user, protect)
 * Body: { subject, category?, relatedOrder?, message }
 *
 * Opens a ticket with the first user message. Status starts at
 * "awaiting_admin"; all admins are notified.
 */
export const createTicket = async (req, res) => {
  try {
    const { subject, category, relatedOrder, message } = req.body || {};

    const subjectClean = cleanText(subject, MAX_SUBJECT);
    const messageClean = cleanText(message, MAX_TEXT);
    if (!subjectClean) {
      return res.status(400).json({ message: "Гарчиг оруулна уу" });
    }
    if (!messageClean) {
      return res.status(400).json({ message: "Зурвас бичнэ үү" });
    }

    const now = new Date();
    const ticket = await SupportTicket.create({
      user: req.user._id,
      subject: subjectClean,
      // Let the schema enum reject an invalid category rather than silently
      // coercing — but only forward a value the client actually sent.
      category: category || undefined,
      relatedOrder: relatedOrder || null,
      status: "awaiting_admin",
      messages: [
        {
          author: "user",
          text: messageClean,
          images: cleanImages(req.body?.images),
          createdAt: now,
        },
      ],
      lastMessageAt: now,
      unreadForAdmin: true,
      unreadForUser: false,
    });

    enqueueAdmins({
      type: "support_opened",
      title: "Шинэ дэмжлэгийн хүсэлт",
      body: `"${snip(ticket.subject)}" сэдвээр шинэ хүсэлт ирлээ.`,
      link: "/admin/support",
      data: { ticketId: String(ticket._id) },
    }).catch(() => {});

    return res.status(201).json({ ticket });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * User — list mine
 * ────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/support/mine   (user, protect)
 * Tickets the current user opened, newest activity first.
 */
export const listMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ user: req.user._id })
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .lean();
    return res.json({ tickets });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * User — get one
 * ────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/support/:id   (user, protect)
 * Full thread for a ticket the user owns. Clears the user-side unread badge.
 */
export const getMyTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Хүсэлт олдсонгүй" });
    if (String(ticket.user) !== String(req.user._id)) {
      return res.status(403).json({ message: "Энэ хүсэлт таных биш" });
    }

    if (ticket.unreadForUser) {
      ticket.unreadForUser = false;
      await ticket.save();
    }

    return res.json({ ticket });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * User — add message
 * ────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/support/:id/messages   (user, protect)
 * Body: { text, images? }
 *
 * Appends a user message, flips the ticket back to "awaiting_admin", and
 * notifies the assigned admin (or all admins if unassigned). Rejected once
 * the ticket is closed.
 */
export const addMyMessage = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Хүсэлт олдсонгүй" });
    if (String(ticket.user) !== String(req.user._id)) {
      return res.status(403).json({ message: "Энэ хүсэлт таных биш" });
    }
    if (ticket.status === "closed") {
      return res.status(400).json({ message: "Хаагдсан хүсэлтэд бичих боломжгүй" });
    }

    const text = cleanText(req.body?.text, MAX_TEXT);
    const images = cleanImages(req.body?.images);
    if (!text && images.length === 0) {
      return res.status(400).json({ message: "Зурвас бичнэ үү" });
    }

    const now = new Date();
    ticket.messages.push({ author: "user", text, images, createdAt: now });
    ticket.status = "awaiting_admin";
    ticket.lastMessageAt = now;
    ticket.unreadForAdmin = true;
    ticket.unreadForUser = false;
    await ticket.save();

    const payload = {
      type: "support_reply",
      title: "Дэмжлэгийн хүсэлтэд хариу ирлээ",
      body: `"${snip(ticket.subject)}" хүсэлтэд хэрэглэгч зурвас бичлээ.`,
      link: "/admin/support",
      data: { ticketId: String(ticket._id) },
    };
    if (ticket.assignedAdmin) {
      enqueue({ ...payload, user: ticket.assignedAdmin }).catch(() => {});
    } else {
      enqueueAdmins(payload).catch(() => {});
    }

    return res.json({ ticket });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * User — close
 * ────────────────────────────────────────────────────────────────────── */

/**
 * PATCH /api/support/:id/close   (user, protect)
 * The opener closes their own ticket (terminal).
 */
export const closeMyTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Хүсэлт олдсонгүй" });
    if (String(ticket.user) !== String(req.user._id)) {
      return res.status(403).json({ message: "Энэ хүсэлт таных биш" });
    }
    if (ticket.status === "closed") {
      return res.status(400).json({ message: "Хүсэлт аль хэдийн хаагдсан байна" });
    }

    ticket.status = "closed";
    await ticket.save();

    return res.json({ ticket });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Admin — list
 * ────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/support/admin?status=   (protect + adminOnly)
 * All tickets, newest activity first; optional status filter.
 */
export const adminListTickets = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const tickets = await SupportTicket.find(filter)
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .populate("user", "name email");
    return res.json({ tickets });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Admin — get one
 * ────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/support/admin/:id   (protect + adminOnly)
 * Full thread; clears the admin-side unread badge.
 */
export const adminGetTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id)
      .populate("user", "name email");
    if (!ticket) return res.status(404).json({ message: "Хүсэлт олдсонгүй" });

    if (ticket.unreadForAdmin) {
      ticket.unreadForAdmin = false;
      await ticket.save();
    }

    return res.json({ ticket });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Admin — reply
 * ────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/support/admin/:id/reply   (protect + adminOnly)
 * Body: { text, images? }
 *
 * Appends an admin message, auto-assigns the ticket to the replying admin if
 * unassigned, flips status to "awaiting_user", and notifies the opener.
 * Rejected once the ticket is closed.
 */
export const adminReply = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Хүсэлт олдсонгүй" });
    if (ticket.status === "closed") {
      return res.status(400).json({ message: "Хаагдсан хүсэлтэд бичих боломжгүй" });
    }

    const text = cleanText(req.body?.text, MAX_TEXT);
    const images = cleanImages(req.body?.images);
    if (!text && images.length === 0) {
      return res.status(400).json({ message: "Зурвас бичнэ үү" });
    }

    const now = new Date();
    ticket.messages.push({
      author: "admin",
      adminUser: req.user._id,
      text,
      images,
      createdAt: now,
    });
    if (!ticket.assignedAdmin) ticket.assignedAdmin = req.user._id;
    ticket.status = "awaiting_user";
    ticket.lastMessageAt = now;
    ticket.unreadForUser = true;
    ticket.unreadForAdmin = false;
    await ticket.save();

    enqueue({
      user: ticket.user,
      type: "support_reply",
      title: "Дэмжлэгийн хүсэлтэд хариу ирлээ",
      body: `"${snip(ticket.subject)}" хүсэлтэд оператор хариу бичлээ.`,
      link: "/support",
      data: { ticketId: String(ticket._id) },
    }).catch(() => {});

    return res.json({ ticket });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Admin — set status
 * ────────────────────────────────────────────────────────────────────── */

/**
 * PATCH /api/support/admin/:id/status   (protect + adminOnly)
 * Body: { status }  — only "resolved" | "open" allowed here.
 *
 * "closed" is reached via the user's close endpoint; the destructive
 * transitions are kept off this knob. Notifies the opener on a real change.
 */
export const adminSetStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!["resolved", "open"].includes(status)) {
      return res.status(400).json({ message: "Зөвхөн 'resolved' эсвэл 'open' статус сонгоно" });
    }

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Хүсэлт олдсонгүй" });
    if (ticket.status === "closed") {
      return res.status(400).json({ message: "Хаагдсан хүсэлтийн статус өөрчлөх боломжгүй" });
    }

    if (ticket.status === status) {
      // No-op change — return as-is without spamming a notification.
      return res.json({ ticket });
    }

    ticket.status = status;
    await ticket.save();

    const body =
      status === "resolved"
        ? `"${snip(ticket.subject)}" хүсэлтийг шийдвэрлэсэн гэж тэмдэглэлээ.`
        : `"${snip(ticket.subject)}" хүсэлтийг дахин нээлээ.`;
    enqueue({
      user: ticket.user,
      type: "support_reply",
      title: "Дэмжлэгийн хүсэлтийн төлөв шинэчлэгдлээ",
      body,
      link: "/support",
      data: { ticketId: String(ticket._id), status },
    }).catch(() => {});

    return res.json({ ticket });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
