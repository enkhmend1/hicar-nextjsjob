import type { AIResponse } from "@/app/lib/services/chat.service";
import type { Message } from "./types";

// ────────────────────────────────────────────────────────────────────
// layoutToMessage — pure dispatcher from AIResponse → chat-bubble payload.
//
// Extracted out of `send()` so the widget's main render path stays
// readable. The function is pure (no hooks, no store touch), trivial
// to unit-test, and the same shape every AI response converges on.
// ────────────────────────────────────────────────────────────────────
export function layoutToMessage(resp: AIResponse): Omit<Message, "id" | "role"> {
  const p = resp.payload || {};
  const msg: Omit<Message, "id" | "role"> = {
    text: resp.reply,
    // Phase H — bubble carries its own confidence/escalation so older
    // bubbles keep their badges when the user keeps chatting.
    confidence: typeof resp.confidence === "number" ? resp.confidence : null,
    escalation: resp.escalation || undefined,
  };
  switch (resp.layout) {
    case "user_cards":
      if (p.items?.length)     msg.products  = p.items;
      if (p.crossRefs?.length) msg.crossRefs = p.crossRefs;
      // Phase AL — bundle/cross-sell suggestions surface as a separate
      // strip below the main result cards.
      if (p.related?.length)   msg.related   = p.related;
      break;
    case "seller_table":
      if (p.columns && p.rows) {
        msg.table = { columns: p.columns, rows: p.rows, summary: p.summary ?? null };
      }
      break;
    case "admin_widget":
      if (p.kind && p.data) {
        msg.widget = { kind: p.kind, title: p.title || "", data: p.data };
      }
      break;
    case "diag_form":
      if (p.fields?.length) {
        msg.diagForm = { partType: p.partType || "", fields: p.fields, note: p.note };
      }
      break;
    case "quotation":
      if (p.bodyText) {
        msg.quotation = {
          quoteId:  p.quoteId  || "",
          bodyText: p.bodyText,
          summary:  (p.summary as Record<string, unknown>) || {},
        };
      }
      break;
    case "diagnostic":
      if (p.candidates?.length || p.clarifyingQuestions?.length) {
        msg.diagnostic = {
          symptom:             p.symptom || "",
          candidates:          p.candidates || [],
          clarifyingQuestions: p.clarifyingQuestions || [],
          urgency:             p.urgency || "low",
        };
      }
      break;
    // "plain" → reply text only.
  }
  return msg;
}
