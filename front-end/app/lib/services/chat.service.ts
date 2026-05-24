/**
 * AI chat service — pure typed wrapper over POST /api/ai/chat.
 *
 * The HTTP shape (request body, response envelope) lives here so
 * widgets don't have to know about discriminated-union layouts or
 * the vehicleContext field name. If we ever change the wire format
 * (e.g. switch to SSE streaming) the migration touches this file
 * and the hook, not 20 component files.
 */

import { api } from "@/lib/api";
import type { ActiveVehicle } from "@/store";

// ────────────────────────────────────────────────────────────────────
// Wire types
// ────────────────────────────────────────────────────────────────────

export interface ProductCardDTO {
  id: string;
  name: string;
  oem: string;
  price: number;
  brand?: string;
  stockQty?: number;
  inStock?: boolean;
}

export interface CrossRefDTO {
  oem:   string;
  brand: string;
  role:  "oem" | "aftermarket";
  note?: string;
}

export interface DiagFieldDTO {
  key: string;
  label: string;
  type: "select" | "year" | "text";
  options?: string[];
  required?: boolean;
}

/**
 * Wire-format AI envelope. Mirrors aiResponse.service.js's buildEnvelope.
 * The discriminated union is on `layout` — frontend dispatchers should
 * narrow on it.
 */
/** Phase I — diagnostic card payload from diagnose_symptom tool. */
export interface DiagnosticCandidateDTO {
  name:       string;
  likelihood: number;            // 0..1, displayed as a bar
  location:   string;
  urgency:    "low" | "medium" | "high";
  oem_hints:  string;
}

export interface AIResponse {
  reply: string;
  layout: "user_cards" | "seller_table" | "admin_widget" | "diag_form" | "diagnostic" | "quotation" | "plain";
  payload: {
    items?:     ProductCardDTO[];
    crossRefs?: CrossRefDTO[];
    meta?: {
      query?: string; category?: string; count?: number;
      plan?: unknown; oemBag?: string[]; primaryOem?: string;
    };
    columns?: string[];
    rows?: Array<Array<string | number | { kind: "link" | "button"; label: string; href?: string; action?: string }>>;
    summary?: Record<string, unknown> | null;
    kind?:  "bar_chart" | "pie_chart" | "kpi_grid" | "line_chart";
    title?: string;
    data?:  Record<string, unknown>;
    partType?: string;
    fields?:   DiagFieldDTO[];
    note?:     string;
    quoteId?:  string;
    bodyText?: string;
    // Phase I — diagnostic layout
    symptom?:             string;
    patternId?:           string | null;
    candidates?:          DiagnosticCandidateDTO[];
    clarifyingQuestions?: string[];
    urgency?:             "low" | "medium" | "high";
    matchStrength?:       number;
  };
  suggestions?: Array<{ label: string; cmd: string }>;
  /**
   * Phase H — overall AI confidence for this turn, 0–100.
   * null when no tools fired (e.g. small-talk, pure greeting).
   * UI bands: ≥90 high (no UI), 70–89 medium (badge), 50–69 low (warning),
   *           <50 critical (escalation banner is also present).
   */
  confidence?: number | null;
  /**
   * Phase H — present when the agent could NOT confidently answer.
   * Frontend renders this as a prominent banner with the CTA.
   */
  escalation?: {
    reason:          "low_confidence" | "tool_error" | "manual";
    message:         string;
    suggestedAction: { kind: "contact_operator"; href: string };
  } | null;
  diagnostics?: Record<string, unknown>;
  toolCalls?: Array<{ name: string; result: unknown }>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
}

export interface SendOptions {
  locale: "mn" | "en";
  /** When present, sent as `vehicleContext` so search_vehicle_parts can fire. */
  vehicle?: ActiveVehicle | null;
}

// ────────────────────────────────────────────────────────────────────
// Service surface — orchestrator hook is the only caller.
// ────────────────────────────────────────────────────────────────────

export const chatService = {
  /**
   * Send the conversation. Returns the raw AI envelope; the caller
   * decides how to dispatch on `layout`.
   *
   * Adapts the Zustand `ActiveVehicle` (with `id`) → wire shape
   * (with `id` aliased; the backend accepts either).
   */
  async send(messages: ChatMessage[], opts: SendOptions): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      messages,
      locale: opts.locale,
    };
    if (opts.vehicle) {
      body.vehicleContext = {
        id:           opts.vehicle.id,
        plate:        opts.vehicle.plate,
        manufacturer: opts.vehicle.manufacturer,
        model:        opts.vehicle.model,
        generation:   opts.vehicle.generation,
        engineCode:   opts.vehicle.engineCode,
        engineType:   opts.vehicle.engineType,
      };
    }
    return api.post<AIResponse>("/ai/chat", body);
  },
};
