/**
 * AI memory service — pure typed wrapper over /api/ai/memory endpoints.
 *
 * Why a service module (vs raw api.post calls in components):
 *   • UI never touches HTTP shape — endpoint paths can be renamed in
 *     one place without grep-spotting widget files.
 *   • Wire types (ServerVehicle, ServerMemory) are defined ONCE and
 *     reused by the orchestrator hook and any future caller.
 *   • Tests can mock this module instead of `fetch`; faster + clearer.
 *
 * Service modules are STATELESS and SIDE-EFFECT-FREE — they only call
 * the API and shape the response. State (Zustand store updates) lives
 * in the consumer (useAgent hook); this lets the same service power
 * SSR / server actions / tests without dragging a React store in.
 */

import { api } from "@/lib/api";
import type { ActiveVehicle } from "@/store";

// ────────────────────────────────────────────────────────────────────
// Wire types — keep in sync with back-end ai.controller responses.
// ────────────────────────────────────────────────────────────────────

export interface ServerVehicle {
  vehicleId:    string;
  plate:        string;
  manufacturer: string;
  model:        string;
  generation?:  string;
  engineCode?:  string;
  engineType?:  string;
}

export interface ServerMemory {
  user?:           string | null;
  activeVehicle:   ServerVehicle | null;
  recentVehicles:  ServerVehicle[];
  recentSearches:  Array<{ query: string; category?: string; resultCount?: number; at: string }>;
  recentProducts:  Array<{ productId: string; name?: string; oem?: string; at: string }>;
  diagnosticState: { symptom?: string; candidateParts?: string[] } | null;
}

/** Adapter: backend's vehicleId → frontend's ActiveVehicle.id. */
export const toActiveVehicle = (v: ServerVehicle): ActiveVehicle => ({
  id:           v.vehicleId,
  plate:        v.plate,
  manufacturer: v.manufacturer,
  model:        v.model,
  generation:   v.generation,
  engineCode:   v.engineCode,
  engineType:   v.engineType,
});

// ────────────────────────────────────────────────────────────────────
// Endpoints
// ────────────────────────────────────────────────────────────────────

export const memoryService = {
  /** GET /api/ai/memory — full memory shape for the logged-in user. */
  async load(): Promise<ServerMemory | null> {
    try {
      const r = await api.get<{ memory: ServerMemory }>("/ai/memory");
      return r.memory ?? null;
    } catch {
      // Anonymous / 401 — memory is opt-in, return null instead of throwing.
      return null;
    }
  },

  /** POST /api/ai/memory/active-vehicle { plate } — Garage.mn lookup + activate. */
  async setActiveByPlate(plate: string): Promise<{ vehicle: ServerVehicle; memory: ServerMemory }> {
    return api.post<{ vehicle: ServerVehicle; memory: ServerMemory }>(
      "/ai/memory/active-vehicle",
      { plate },
    );
  },

  /** POST /api/ai/memory/active-vehicle { vehicleId } — activate from recents. */
  async setActiveByVehicleId(vehicleId: string): Promise<{ vehicle: ServerVehicle; memory: ServerMemory }> {
    return api.post<{ vehicle: ServerVehicle; memory: ServerMemory }>(
      "/ai/memory/active-vehicle",
      { vehicleId },
    );
  },

  /** DELETE /api/ai/memory/active-vehicle — drop active, keep history. */
  async clearActive(): Promise<{ memory: ServerMemory }> {
    return api.delete<{ memory: ServerMemory }>("/ai/memory/active-vehicle");
  },
};
