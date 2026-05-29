/**
 * Product moderation policy — Phase O.
 *
 * The product approval lifecycle has one big behavioural question every
 * time a seller edits a published listing:
 *
 *   "Does this edit need to go back through admin review?"
 *
 * Pre-Phase O the answer was a blunt YES for any seller edit, which
 * turned trivial fixes (add a photo, bump stock) into 1-day approval
 * waits and crushed seller velocity. New policy: only RISKY fields
 * trigger re-pending. Visual + operational tweaks stay approved.
 *
 * Risky vs safe split (rationale):
 *
 *   RISKY — these could change what the listing FUNDAMENTALLY IS or
 *   trick a buyer who already saw the approved version:
 *     name        — bait-and-switch a different product
 *     oem         — list under a wrong OEM, broken compatibility
 *     category    — miscategorise (search relevance + tax/import)
 *     price       — pricing-fraud / arbitrage risk
 *     fitments    — affects which vehicles see this in lookup
 *     attributes  — category-validated specs (size, type, position)
 *     compatible  — vehicle compatibility list (free-text shadow of
 *                   fitments — still affects discoverability)
 *
 *   SAFE — visual or operational, can't mislead a buyer:
 *     images, stockQty, inStock, lowStockThreshold, description,
 *     deliveryDays, tags, originalPrice, warehouseLocation
 *
 * Comparison uses JSON-equality so a payload that re-sends the SAME
 * value for a risky field doesn't reset status. (Sellers' forms
 * typically PUT the full object, not a partial patch — without this
 * the policy would be useless because every save touches every field.)
 */

/** Fields whose changes require admin re-approval. Frozen so a future
 *  edit can't silently widen the policy. Order doesn't matter. */
export const RISKY_FIELDS = Object.freeze([
  "name", "oem", "category", "price", "fitments", "attributes", "compatible",
]);

/**
 * Does this update payload change a RISKY field vs the existing doc?
 *
 *   existing  — current Product document (or plain object with same shape)
 *   update    — validated patch about to be applied
 *
 * Returns true if at least one risky field is in the update AND has a
 * different JSON serialisation than the existing value. Same-value
 * re-submissions (form re-PUTs the whole object) return false.
 *
 * Does NOT consider whether the existing status is "approved" — that
 * gate stays in the caller, because rejected / pending products have
 * their own state transitions.
 */
export const requiresReapproval = (existing, update) => {
  if (!existing || !update) return false;
  return RISKY_FIELDS.some((f) => {
    if (!Object.prototype.hasOwnProperty.call(update, f)) return false;
    return JSON.stringify(existing[f]) !== JSON.stringify(update[f]);
  });
};
