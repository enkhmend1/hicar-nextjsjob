/**
 * Unit tests for the escrow money-split math (Service/escrow.service.js).
 *
 * Uses Node's built-in test runner — no extra dependency, per CLAUDE.md
 * ("don't invent a test framework"). Run with: `npm test` (node --test).
 *
 * computeSplit() is the authoritative server-side calculation that freezes
 * each line item's revenue, platform fee, and seller payout at payment time.
 * These tests pin the Hard-rule invariants:
 *   - escrow split = item price × qty only
 *   - delivery fee is NOT escrowed
 *   - money is integer MNT (round half-away-from-zero)
 *   - missing seller in feeMap → 5% default fee + empty bank snapshot
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSplit } from "../Service/escrow.service.js";

const EMPTY_BANK = { bankName: "", bankAccount: "", bankHolderName: "" };

test("single item, default 5% fee when seller absent from feeMap", () => {
  const order = { items: [{ seller: "s1", price: 10000, quantity: 2 }] };
  const split = computeSplit(order, new Map());

  assert.equal(split.items.length, 1);
  assert.equal(split.items[0].lineRevenue, 20000);
  assert.equal(split.items[0].platformFee, 1000); // 5% of 20000
  assert.equal(split.items[0].sellerPayout, 19000);
  assert.equal(split.items[0].sellerFeePercent, 5);
  assert.deepEqual(split.items[0].bankSnapshot, EMPTY_BANK);

  assert.equal(split.platformFeeTotal, 1000);
  assert.equal(split.sellerPayoutTotal, 19000);
  assert.equal(split.escrowAmount, 19000);
});

test("custom seller fee percent from feeMap is applied", () => {
  const order = { items: [{ seller: "s1", price: 10000, quantity: 2 }] };
  const feeMap = new Map([
    ["s1", { feePercent: 7, bankSnapshot: { bankName: "Khan", bankAccount: "123", bankHolderName: "A" } }],
  ]);
  const split = computeSplit(order, feeMap);

  assert.equal(split.items[0].lineRevenue, 20000);
  assert.equal(split.items[0].platformFee, 1400); // 7% of 20000
  assert.equal(split.items[0].sellerPayout, 18600);
  assert.equal(split.items[0].sellerFeePercent, 7);
  assert.deepEqual(split.items[0].bankSnapshot, { bankName: "Khan", bankAccount: "123", bankHolderName: "A" });
  assert.equal(split.escrowAmount, 18600);
});

test("multiple items across multiple sellers aggregate correctly", () => {
  const order = {
    items: [
      { seller: "s1", price: 10000, quantity: 1 }, // rev 10000
      { seller: "s2", price: 5000, quantity: 2 },  // rev 10000
    ],
  };
  const feeMap = new Map([
    ["s1", { feePercent: 5, bankSnapshot: EMPTY_BANK }],
    ["s2", { feePercent: 10, bankSnapshot: EMPTY_BANK }],
  ]);
  const split = computeSplit(order, feeMap);

  assert.equal(split.items[0].platformFee, 500);  // 5%
  assert.equal(split.items[0].sellerPayout, 9500);
  assert.equal(split.items[1].platformFee, 1000); // 10%
  assert.equal(split.items[1].sellerPayout, 9000);

  assert.equal(split.platformFeeTotal, 1500);
  assert.equal(split.sellerPayoutTotal, 18500);
  assert.equal(split.escrowAmount, 18500);
});

test("money is integer MNT — fee rounds half-away-from-zero", () => {
  // lineRevenue 210 × 5% = 10.5 → rounds to 11 (not 10).
  const order = { items: [{ seller: "s1", price: 210, quantity: 1 }] };
  const split = computeSplit(order, new Map());

  assert.equal(split.items[0].lineRevenue, 210);
  assert.equal(split.items[0].platformFee, 11);
  assert.equal(split.items[0].sellerPayout, 199);
  assert.ok(Number.isInteger(split.platformFeeTotal));
  assert.ok(Number.isInteger(split.sellerPayoutTotal));
  assert.ok(Number.isInteger(split.escrowAmount));
});

test("delivery fee is NOT escrowed — escrowAmount ignores order.deliveryFee/total", () => {
  const order = {
    deliveryFee: 8000,
    total: 28000, // 20000 goods + 8000 delivery
    items: [{ seller: "s1", price: 10000, quantity: 2 }],
  };
  const split = computeSplit(order, new Map());

  // Escrow only covers the seller payout on goods, never the delivery fee.
  assert.equal(split.escrowAmount, 19000);
  assert.equal(split.escrowAmount, split.sellerPayoutTotal);
  assert.notEqual(split.escrowAmount, order.total);
});

test("missing/zero price or quantity yields zero line revenue", () => {
  const order = {
    items: [
      { seller: "s1", quantity: 3 },               // no price
      { seller: "s1", price: 10000, quantity: 0 }, // zero qty
    ],
  };
  const split = computeSplit(order, new Map());

  assert.equal(split.items[0].lineRevenue, 0);
  assert.equal(split.items[0].platformFee, 0);
  assert.equal(split.items[0].sellerPayout, 0);
  assert.equal(split.items[1].lineRevenue, 0);
  assert.equal(split.escrowAmount, 0);
});

test("empty order produces zeroed totals", () => {
  const split = computeSplit({ items: [] }, new Map());
  assert.deepEqual(split.items, []);
  assert.equal(split.platformFeeTotal, 0);
  assert.equal(split.sellerPayoutTotal, 0);
  assert.equal(split.escrowAmount, 0);
});
