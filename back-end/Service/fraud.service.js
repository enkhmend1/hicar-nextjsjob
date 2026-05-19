/**
 * Fraud analysis service.
 *
 * Given a dispute (buyer claim + optional seller response + history signals),
 * use OpenAI function-calling to return a structured fraud assessment. The
 * model is FORCED to call our tool so the output is always valid JSON in the
 * shape we expect — no free-form parsing.
 *
 * Falls back to a rule-based heuristic when OpenAI is disabled, so the
 * dispute flow keeps working in local dev / CI / no-AI deployments.
 */

import { openai, openaiEnabled, openaiModel } from "../Config/openai.js";
import Dispute from "../Model/dispute.model.js";
import Order from "../Model/order.model.js";

/* ──────────────────────────────────────────────────────────────────────
 * Signal collection
 * ────────────────────────────────────────────────────────────────────── */

/**
 * History signals for the BUYER. High counts of recent disputes, especially
 * if many are still open, is the strongest single fraud signal we have.
 */
const buildBuyerHistory = async (buyerId) => {
  const [totalOrders, disputes] = await Promise.all([
    Order.countDocuments({ user: buyerId, paymentStatus: { $in: ["PAID", "PAID_OUT", "REFUNDED", "PARTIAL_REFUND"] } }),
    Dispute.find({ buyer: buyerId })
      .select("status reason resolution.action resolution.resolvedBy createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);
  const recentDisputes = disputes.filter((d) =>
    Date.now() - new Date(d.createdAt).getTime() < 90 * 24 * 60 * 60 * 1000);
  const refundedDisputes = disputes.filter((d) =>
    ["resolved_refund", "resolved_partial"].includes(d.status));
  const releasedDisputes = disputes.filter((d) =>
    d.status === "resolved_release");

  return {
    totalOrders,
    totalDisputes: disputes.length,
    recentDisputes90d: recentDisputes.length,
    refundedDisputes: refundedDisputes.length,
    releasedDisputes: releasedDisputes.length,
    /** Share of orders that resulted in a dispute — > 30% is a red flag. */
    disputeRate: totalOrders > 0 ? +(disputes.length / totalOrders).toFixed(3) : 0,
    /** Win rate for the buyer in past disputes — high means they keep getting refunds. */
    refundWinRate: disputes.length > 0 ? +(refundedDisputes.length / disputes.length).toFixed(3) : 0,
    reasonsUsed: [...new Set(disputes.map((d) => d.reason))],
  };
};

/**
 * History signals for the SELLER. Pattern of complaints across orders is a
 * counter-signal — high dispute rate on the seller side rebalances toward
 * believing the buyer.
 */
const buildSellerHistory = async (sellerId) => {
  const [totalOrders, disputes] = await Promise.all([
    Order.countDocuments({ "items.seller": sellerId, paymentStatus: { $in: ["PAID", "PAID_OUT", "REFUNDED", "PARTIAL_REFUND"] } }),
    Dispute.find({ seller: sellerId })
      .select("status reason resolution.action createdAt")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);
  return {
    totalOrders,
    totalDisputes: disputes.length,
    disputeRate: totalOrders > 0 ? +(disputes.length / totalOrders).toFixed(3) : 0,
    /** Fraction of disputes that resulted in a refund — high is bad for seller credibility. */
    refundedShare: disputes.length > 0
      ? +(disputes.filter((d) => ["resolved_refund", "resolved_partial"].includes(d.status)).length / disputes.length).toFixed(3)
      : 0,
    /** Most-cited dispute reason across this seller — pattern recognition. */
    topReason: ((arr) => {
      const counts = {};
      for (const d of arr) counts[d.reason] = (counts[d.reason] || 0) + 1;
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    })(disputes),
  };
};

/* ──────────────────────────────────────────────────────────────────────
 * OpenAI function-calling
 * ────────────────────────────────────────────────────────────────────── */

const FRAUD_TOOL = {
  type: "function",
  function: {
    name: "submit_fraud_assessment",
    description: "Return a structured fraud risk assessment for an e-commerce dispute.",
    parameters: {
      type: "object",
      properties: {
        fraudScore: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "How likely the BUYER is acting fraudulently. 0 = clearly legitimate complaint, 100 = clearly fraudulent claim.",
        },
        confidence: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "How sure you are in your fraudScore. < 60 means the case is genuinely ambiguous and should be escalated.",
        },
        recommendedAction: {
          type: "string",
          enum: ["refund_full", "refund_partial", "release_seller", "reject_claim", "escalate"],
          description: "What the platform should do. 'escalate' when confidence is low.",
        },
        reasoning: {
          type: "string",
          description: "Short (1-3 sentences) Mongolian explanation. Will be shown to the admin.",
        },
        flags: {
          type: "array",
          items: { type: "string" },
          description: "Short reason codes — e.g. 'buyer_high_dispute_rate', 'seller_no_response', 'evidence_unclear'.",
        },
      },
      required: ["fraudScore", "confidence", "recommendedAction", "reasoning", "flags"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `Та бол Монголын автомашины сэлбэгийн онлайн худалдааны платформын маргаан шинжээч AI.
Зорилго: худалдан авагч (buyer) болон худалдагч (seller)-ын аль нь үнэн зөв байгааг үнэлэх.

Дүн шинжилгээ:
- Buyer-ын өмнөх маргааны түүх — олон удаа маргаан үүсгэсэн, маш олон удаа буцаалт авсан бол сэжигтэй.
- Seller-ын өмнөх маргааны түүх — нийт захиалгаас маш олон маргаантай бол buyer-ийн талд бод.
- Маргааны шалтгаан, нотолгоо (зураг) хангалттай эсэх.
- Seller хариу өгөөгүй бол buyer-ийн талд бод.

Зөвхөн submit_fraud_assessment функцийг дуудаж хариул. Reasoning Монгол хэлээр 1-3 өгүүлбэр.`;

/* ──────────────────────────────────────────────────────────────────────
 * Heuristic fallback (when OpenAI is disabled)
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Pure deterministic scoring — used both as a fallback AND as a sanity check
 * on the AI score so we never refund a clearly-fraudulent buyer just because
 * the model hallucinated.
 */
export const heuristicScore = ({ buyerHistory, sellerHistory, sellerResponse }) => {
  let score = 30; // start neutral-low
  const flags = [];

  if (buyerHistory.disputeRate > 0.3) {
    score += 25;
    flags.push("buyer_high_dispute_rate");
  }
  if (buyerHistory.refundWinRate > 0.7 && buyerHistory.totalDisputes >= 3) {
    score += 20;
    flags.push("buyer_serial_refunder");
  }
  if (buyerHistory.recentDisputes90d >= 3) {
    score += 15;
    flags.push("buyer_recent_disputes");
  }
  if (sellerHistory.disputeRate > 0.2 && sellerHistory.refundedShare > 0.5) {
    score -= 30;
    flags.push("seller_pattern_of_problems");
  }
  if (!sellerResponse?.respondedAt) {
    score -= 25;
    flags.push("seller_no_response");
  }
  if (sellerResponse?.action === "refund_offered") {
    score -= 20;
    flags.push("seller_admitted");
  }

  const fraudScore = Math.max(0, Math.min(100, score));
  let recommendedAction;
  if (fraudScore >= 70)      recommendedAction = "release_seller";
  else if (fraudScore <= 30) recommendedAction = "refund_full";
  else                       recommendedAction = "escalate";

  return {
    fraudScore,
    confidence: 55, // heuristic is moderately confident
    recommendedAction,
    reasoning: `Heuristic үнэлгээ (OpenAI идэвхгүй): score=${fraudScore}.`,
    flags,
  };
};

/* ──────────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Score a dispute. Returns an object suitable for writing into
 * `dispute.aiAnalysis`. Does NOT save — caller decides when.
 */
export const analyseDispute = async (dispute) => {
  const [buyerHistory, sellerHistory] = await Promise.all([
    buildBuyerHistory(dispute.buyer),
    buildSellerHistory(dispute.seller),
  ]);

  const heuristic = heuristicScore({
    buyerHistory, sellerHistory,
    sellerResponse: dispute.sellerResponse,
  });

  if (!openaiEnabled) {
    return {
      ...heuristic,
      buyerHistory, sellerHistory,
      analyzedAt: new Date(),
      model: "heuristic-v1",
    };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: openaiModel,
      temperature: 0.2,
      tools: [FRAUD_TOOL],
      tool_choice: { type: "function", function: { name: "submit_fraud_assessment" } },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            dispute: {
              reason: dispute.reason,
              description: dispute.description,
              evidenceImagesCount: dispute.evidenceImages?.length ?? 0,
              requestedRefundAmount: dispute.requestedRefundAmount,
            },
            sellerResponse: dispute.sellerResponse || null,
            buyerHistory,
            sellerHistory,
          }),
        },
      ],
    });

    const call = completion.choices[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("OpenAI returned no tool_call");
    const args = JSON.parse(call.function.arguments);

    // Safety belt: if the AI says "refund the buyer" but the heuristic
    // sees serial-refunder flags, force an escalation. Better to bother
    // an admin than to give money to a known fraudster.
    let action = args.recommendedAction;
    if (action === "refund_full" && heuristic.flags.includes("buyer_serial_refunder")) {
      action = "escalate";
      args.flags = [...(args.flags || []), "override_heuristic_serial_refunder"];
    }

    return {
      fraudScore: args.fraudScore,
      confidence: args.confidence,
      recommendedAction: action,
      reasoning: args.reasoning,
      flags: args.flags || [],
      buyerHistory,
      sellerHistory,
      analyzedAt: new Date(),
      model: openaiModel,
    };
  } catch (err) {
    // On AI failure, fall back to heuristic — don't block the dispute flow.
    return {
      ...heuristic,
      buyerHistory, sellerHistory,
      analyzedAt: new Date(),
      model: `heuristic-fallback (ai_error: ${err.message})`,
    };
  }
};
