/**
 * Quick check: numeric POS spot ordering (1..12 style, not 1,10,11,2).
 * Run: npx tsx scripts/verify-pos-spot-sort.ts
 */

import assert from "node:assert/strict";

import { comparePosSpotsByPosNumberAsc, sortPosSpotsByPosNumberAsc } from "../lib/posSpotSort";
import type { PosSpot } from "../lib/posSpotTypes";

function spot(posNumber: string, spotName = `spot-${posNumber}`): PosSpot {
  return {
    id: spotName,
    spotName,
    partnerLocationId: "partner",
    posNumber,
    posName: spotName,
    spotSlug: spotName,
    currentOfferId: "offer",
    status: "available",
    checkStatus: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const unsorted = [
  spot("10"),
  spot("2"),
  spot("11"),
  spot("8"),
  spot("1"),
  spot("12"),
  spot("9"),
];

const sorted = sortPosSpotsByPosNumberAsc(unsorted);
assert.deepEqual(
  sorted.map((s) => s.posNumber),
  ["1", "2", "8", "9", "10", "11", "12"],
);

assert.ok(comparePosSpotsByPosNumberAsc(spot("9"), spot("10")) < 0);
assert.ok(comparePosSpotsByPosNumberAsc(spot("10"), spot("2")) > 0);

console.log("verify-pos-spot-sort: ok");
