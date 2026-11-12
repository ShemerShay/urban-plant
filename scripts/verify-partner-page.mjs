import assert from "node:assert/strict";

import {
  countPlantSpots,
  groupPlantSpotsByType,
  isCountedPlantSpot,
  resolveSpotOffers,
} from "../lib/partnerPlantSummary.ts";
import {
  parsePartnerProfileFields,
  withExistingPartnerProfileFields,
} from "../lib/partnerProfileValidation.ts";

function spot(id, offerId, status, pocketId) {
  return {
    id,
    spotName: id,
    partnerLocationId: "partner-1",
    posName: id,
    spotSlug: id,
    currentOfferId: offerId,
    status,
    checkStatus: false,
    createdAt: "2026-09-22T00:00:00.000Z",
    ...(pocketId ? { pocketId } : {}),
  };
}

// Offer status is deliberately mixed; Partner logic must ignore it.
const offers = [
  { id: "offer-dracaena-1", productId: "dracaena", status: "active" },
  { id: "offer-dracaena-old", productId: "dracaena", status: "inactive" },
  { id: "offer-ficus", productId: "ficus", status: "active" },
  { id: "offer-ficus-old", productId: "ficus", status: "inactive" },
  { id: "offer-flower", productId: "bouquet", status: "active" },
  { id: "offer-orphan-product", productId: "deleted-plant", status: "active" },
];

const products = new Map([
  ["dracaena", { name: "Dracaena Marginata", inventoryType: "plants" }],
  ["ficus", { name: "Ficus", inventoryType: "plants" }],
  ["bouquet", { name: "Bouquet", inventoryType: "flowers" }],
]);

const all = [
  spot("pos-available", "offer-dracaena-1", "available", "pocket-a"),
  spot("pos-available-old-offer", "offer-dracaena-old", "available", "pocket-a"),
  spot("pos-sold", "offer-dracaena-1", "sold", "pocket-a"),
  spot("pos-sold-old-offer", "offer-dracaena-old", "sold", "pocket-a"),
  spot("pos-inactive-old-offer", "offer-dracaena-old", "inactive", "pocket-a"),
  spot("pos-held", "offer-dracaena-1", "held_for_payment", "pocket-a"),
  spot("pos-ficus", "offer-ficus", "available", "pocket-a"),
  spot("pos-flower", "offer-flower", "available", "pocket-a"),
  spot("pos-flower-sold", "offer-flower", "sold", "pocket-a"),
  spot("pos-unknown-product", "offer-orphan-product", "available", "pocket-a"),
  spot("pos-unknown-offer", "offer-missing", "sold", "pocket-a"),
  spot("pos-ficus-old-unassigned", "offer-ficus-old", "inactive"),
];

const spotOffers = resolveSpotOffers(all, offers, products);
const offerById = new Map(spotOffers.map((offer) => [offer.id, offer]));

assert.equal(offerById.get("offer-dracaena-old")?.inventoryType, "plants", "inactive offer still resolves");
assert.equal(offerById.get("offer-dracaena-old")?.productName, "Dracaena Marginata");
assert.equal(offerById.get("offer-flower")?.inventoryType, "flowers");
assert.equal(offerById.get("offer-orphan-product")?.inventoryType, null, "missing product is not assumed to be a plant");
assert.equal(offerById.get("offer-missing")?.inventoryType, null, "missing offer is not assumed to be a plant");

const counted = all.filter((item) => isCountedPlantSpot(item, offerById.get(item.currentOfferId)));
assert.deepEqual(
  counted.map((item) => item.id),
  [
    "pos-available",
    "pos-available-old-offer",
    "pos-sold",
    "pos-sold-old-offer",
    "pos-inactive-old-offer",
    "pos-ficus",
    "pos-ficus-old-unassigned",
  ],
  "held, flowers and unresolvable rows are excluded; inactive-offer plant rows are kept",
);

assert.deepEqual(countPlantSpots(counted), { active: 3, total: 7 }, "location = available/total");

const emptyAvailable = {
  ...spot("pos-empty", "offer-dracaena-1", "available"),
};
delete emptyAvailable.currentOfferId;
assert.equal(
  isCountedPlantSpot(emptyAvailable, offerById.get(emptyAvailable.currentOfferId)),
  false,
  "empty/removed POS must not count as an active plant",
);
assert.deepEqual(
  countPlantSpots([...counted, emptyAvailable].filter((item) => isCountedPlantSpot(item, offerById.get(item.currentOfferId)))),
  { active: 3, total: 7 },
  "empty POS is excluded from partner plant counts",
);

const pocketA = counted.filter((item) => item.pocketId === "pocket-a");
assert.deepEqual(countPlantSpots(pocketA), { active: 3, total: 6 }, "pocket = available/total");

const groups = groupPlantSpotsByType(pocketA, offerById);
assert.deepEqual(
  groups.map((group) => [group.id, group.name, countPlantSpots(group.spots)]),
  [
    ["dracaena", "Dracaena Marginata", { active: 2, total: 5 }],
    ["ficus", "Ficus", { active: 1, total: 1 }],
  ],
  "plant group = available/total, grouped by product across active and inactive offers",
);
assert.deepEqual(
  groups[0].spots.map((item) => item.id).sort(),
  ["pos-available", "pos-available-old-offer", "pos-inactive-old-offer", "pos-sold", "pos-sold-old-offer"],
  "opened group shows available, sold and inactive rows (including inactive-offer rows), never held",
);
assert.deepEqual(
  new Set(groups[0].spots.map((item) => item.status)),
  new Set(["available", "sold", "inactive"]),
);

assert.deepEqual(countPlantSpots([]), { active: 0, total: 0 });

const existingProfile = {
  monthlyRevenue: 1200,
  setupCost: 450,
  notes: "Keep this note",
};

function parseProfilePatch(patch) {
  return parsePartnerProfileFields(
    withExistingPartnerProfileFields(patch, existingProfile),
  );
}

const omittedProfile = parseProfilePatch({});
assert.equal(omittedProfile.ok, true);
assert.deepEqual(
  {
    monthlyRevenue: omittedProfile.value.monthlyRevenue,
    setupCost: omittedProfile.value.setupCost,
    notes: omittedProfile.value.notes,
  },
  existingProfile,
  "omitted profile fields remain unchanged",
);

const mixedOmitProfile = parseProfilePatch({ monthlyRevenue: 2400 });
assert.equal(mixedOmitProfile.ok, true);
assert.deepEqual(
  {
    monthlyRevenue: mixedOmitProfile.value.monthlyRevenue,
    setupCost: mixedOmitProfile.value.setupCost,
    notes: mixedOmitProfile.value.notes,
  },
  { monthlyRevenue: 2400, setupCost: 450, notes: "Keep this note" },
  "explicit monthlyRevenue updates; omitted setupCost and notes stay",
);

const updatedProfile = parseProfilePatch({
  monthlyRevenue: 2400,
  setupCost: 900,
  notes: "Updated note",
});
assert.equal(updatedProfile.ok, true);
assert.deepEqual(
  {
    monthlyRevenue: updatedProfile.value.monthlyRevenue,
    setupCost: updatedProfile.value.setupCost,
    notes: updatedProfile.value.notes,
  },
  { monthlyRevenue: 2400, setupCost: 900, notes: "Updated note" },
  "explicit profile fields update",
);

const clearedProfile = parseProfilePatch({
  monthlyRevenue: 0,
  setupCost: 0,
  notes: "",
});
assert.equal(clearedProfile.ok, true);
assert.deepEqual(
  {
    monthlyRevenue: clearedProfile.value.monthlyRevenue,
    setupCost: clearedProfile.value.setupCost,
    notes: clearedProfile.value.notes,
  },
  { monthlyRevenue: 0, setupCost: 0, notes: "" },
  "explicit zero values and empty notes remain intentional updates",
);

const negativeRevenue = parseProfilePatch({ monthlyRevenue: -1 });
assert.deepEqual(negativeRevenue, {
  ok: false,
  error: "monthlyRevenue must be a non-negative number",
});
const negativeSetupCost = parseProfilePatch({ setupCost: -1 });
assert.deepEqual(negativeSetupCost, {
  ok: false,
  error: "setupCost must be a non-negative number",
});

console.log("Partner page plant counts and PATCH profile semantics verified.");
