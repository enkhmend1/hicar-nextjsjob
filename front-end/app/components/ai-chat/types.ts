/**
 * Shared chat-widget types — extracted from AIChatWidget.tsx so the main
 * component and every sub-renderer (DiagnosticCard, layoutToMessage, …) share
 * one TS contract instead of re-declaring overlapping shapes.
 *
 * The wire shape (AIResponse) is owned by chat.service.ts; the aliases below
 * preserve the legacy component-local field names without re-declaring it.
 */
import type { AIResponse } from "@/app/lib/services/chat.service";

export type ProductCard = {
  id: string;
  name: string;
  oem: string;
  price: number;
  brand?: string;
  stockQty?: number;
  inStock?: boolean;
};

export type Suggestion = { label: string; cmd: string };

export type DiagField = NonNullable<AIResponse["payload"]["fields"]>[number];
export type CrossRef  = NonNullable<AIResponse["payload"]["crossRefs"]>[number];

export interface Message {
  id: number;
  role: "ai" | "user";
  text?: string;
  imageUrl?: string;
  products?: ProductCard[];
  crossRefs?: CrossRef[];
  /** Phase AL — bundle suggestions ("Хамт ихэвчлэн авдаг"). */
  related?: ProductCard[];
  lowStock?: ProductCard[];
  excelHint?: { filename: string };
  /** Seller-table renderer payload from layout="seller_table". */
  table?: { columns: string[]; rows: NonNullable<AIResponse["payload"]["rows"]>; summary?: Record<string, unknown> | null };
  /** Admin chart-ready payload from layout="admin_widget". */
  widget?: { kind: NonNullable<AIResponse["payload"]["kind"]>; title: string; data: Record<string, unknown> };
  /** Disambiguation form from layout="diag_form". */
  diagForm?: { partType: string; fields: DiagField[]; note?: string };
  /** Phase B — generated B2B quotation block. */
  quotation?: { quoteId: string; bodyText: string; summary: Record<string, unknown> };
  /** Phase I — diagnostic card. */
  diagnostic?: {
    symptom:             string;
    candidates:          NonNullable<AIResponse["payload"]["candidates"]>;
    clarifyingQuestions: string[];
    urgency:             "low" | "medium" | "high";
  };
  /**
   * Phase H — confidence + escalation attached to assistant bubbles.
   * Only assistant bubbles can carry these (user messages always 100%).
   */
  confidence?: number | null;
  escalation?: NonNullable<AIResponse["escalation"]>;
  error?: boolean;
}
