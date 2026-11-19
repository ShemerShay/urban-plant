# Slice 4 — work summary

Parent: `catalog-analytics-infrastructure-changes`  
Child: `catalog/offers-on-sellable-variants`  
Parent HEAD when the child was created: `a84836990424cbc0bb31f76c443ed91489aef432`  
Roadmap: `docs/product-variant-offer-architecture.md`  
Plan: `docs/slice-4-plan-summary.md`  
Previous slice: `docs/slice-3-work-summary.md`

Status as of 2026-10-25:

- Slice 4 is committed on the child branch.
- Migration `048` was applied only to Neon branch `dev-partner-page`. That limit is an execution decision, not runner logic.
- Nothing was pushed, merged, or deployed.
- Production and local `master` were not changed.

---

## 1. Timeline

1. **Read the plan.** `docs/slice-4-plan-summary.md` was read into the chat. At that point Slice 4 was planned only.
2. **Implement.** The child branch was created from parent HEAD `a848369`, and the approved plan was implemented. Shop, cart, checkout, holds, and POS were left on their current paths.
3. **Verify.** Typecheck, `verify-offer-variants`, and the Slice 3 verification set passed.
4. **Harden, then commit.** `GET /api/offers` was given the existing admin check. The temporary migration-`048` host rule was removed from the generic runner. The same verification set passed again, and the slice was committed on the child branch.

---

## 2. Branch

| | |
|---|---|
| Child | `catalog/offers-on-sellable-variants` |
| Created from | `a84836990424cbc0bb31f76c443ed91489aef432` |
| Commit | `Add variant-backed offer availability`, on top of `a848369` |

Untracked files that were already in the tree were left untracked and were not staged. That includes the older slice summaries, `docs/product-variant-offer-architecture.md`, and `scripts/_tmp-historical-baseline-xlsx.mjs`.

---

## 3. Offer model

A new plant Offer is:

```text
Sellable Variant
  + one consumer selling price
  + status
  + zero or more availability contexts
```

Availability contexts are Catalog and Partner Location. The same Offer may be in Catalog, one Partner Location, several Partner Locations, or Catalog plus Partner Locations. Grain is Partner Location, not Partner.

Same Sellable Variant and same `consumerPrice` are the same Offer. A different consumer price is a different Offer. Flowers stay outside the Sellable Variant model.

---

## 4. Schema

Migration: `db/migrations/048_offers_on_sellable_variants.sql`.

No inserts, no updates of existing rows, and no backfill. After apply, variant-backed offers were 0 and `offer_availabilities` was empty.

`offers.sellable_variant_id` is a nullable uuid referencing `sellable_variants (id)` with `ON DELETE RESTRICT`. It stays nullable so existing plant Offers, flower Offers, and the manual Offer remain valid.

`offers.variant_id` is unchanged. It still means Plant Size. New plant Offers leave it null. It is not dropped in this slice.

`offer_availabilities`:

| Column | |
|---|---|
| `id` | uuid primary key |
| `offer_id` | `text NOT NULL`, cascade on Offer delete |
| `scope` | `catalog` or `partner_location` |
| `partner_location_id` | `text NULL`, restrict on location delete |
| `created_at`, `updated_at` | timestamptz |

Catalog means `partner_location_id` is null. A partner-location row requires a location id. Unique key: `UNIQUE NULLS NOT DISTINCT (offer_id, scope, partner_location_id)`.

Indexes:

- `offers (sellable_variant_id) WHERE sellable_variant_id IS NOT NULL`
- `offer_availabilities (partner_location_id) WHERE partner_location_id IS NOT NULL`
- unique `(sellable_variant_id, consumer_price) WHERE sellable_variant_id IS NOT NULL`

`numeric(10,2)` makes `89` and `89.00` the same price. Status is not part of that key. Null `sellable_variant_id` is outside the index, so legacy rows, flowers, and the manual Offer may still share a price.

---

## 5. Integrity and concurrency

`enforce_offer_sellable_variant_integrity()` runs before writes to `offers` and `offer_availabilities`. It locks `sellable_variants.id`, then rejects:

- a set `sellable_variant_id` whose `product_id` is not that variant’s plant
- a flower `product_id` with `sellable_variant_id` set
- an availability row whose Offer has no Sellable Variant
- more than one active Catalog Offer for the same Sellable Variant

A Catalog violation raises `23505`. The API returns `409`. Zero active Catalog Offers is valid. An inactive Catalog Offer may sit beside an active one.

`apply_plant_offer(...)` is the create/reuse path. It locks the Sellable Variant, re-reads stored Offers, reuses or inserts, then applies status and availabilities in that same database call. Concurrent creates for one variant serialize on the lock and re-check stored state after the lock. A unique-index violation aborts the transaction and becomes `409`. It is not caught in order to continue inside the failed transaction. The unique index remains the backstop.

Deleting a Sellable Variant that an Offer references maps the foreign-key error to the existing in-use `409`. A Partner Location referenced by an availability row cannot be deleted. Deactivating an Offer keeps its availability rows and frees the Catalog slot.

---

## 6. Create, reuse, and edit

`POST /api/offers?inventoryType=plants` requires a Sellable Variant, a consumer price, and status. Availabilities may be omitted or empty. Blank price is rejected. `0` is an explicit price. Supplier cost is never copied or shown.

The server sets `product_id` from the variant. A conflicting `productId` is rejected. A body `variantId` is rejected. `offers.variant_id` stays null.

Same variant and same price, in one locked operation:

- reuse the existing Offer
- apply the submitted status
- add the submitted availability contexts
- keep contexts the Offer already has
- do not insert another Offer

If that change would create a second active Catalog Offer, the call returns `409` and rolls back. Status and availabilities stay as they were.

The create result may say that the existing Offer was updated. That message is the approved visible result. Editing a variant-backed Offer onto a price already used by another Offer for that variant returns `409`. Edit does not merge Offers. Edit replaces the saved availability set with the submitted checkboxes.

Flower creation is a separate writer, `appendFlowerOffer`. It sets no Sellable Variant and no availability rows. The API rejects `sellableVariantId` and `availabilities` on flowers.

`appendOffer` is gone. There is no runtime writer that creates a new plant Offer with a null `sellable_variant_id`. Existing legacy rows stay readable and editable as plant, price, and status. They cannot gain a variant or availabilities. `scripts/seed-from-json.mjs` still upserts historical rows and does not set `sellable_variant_id`.

---

## 7. Admin

No `/admin/variants` page and no new navigation item. `/admin/offers/plants` stays on `AdminOffersManager`.

Plant create:

1. One select of existing Sellable Variants, from admin-only `GET /api/sellable-variants`. Label: plant name, plant size, and pot name plus pot size, or “No pot”. Nothing is created from this list.
2. Consumer price.
3. Active or inactive.
4. A Catalog checkbox, and one checkbox per Partner Location from `GET /api/partners`. Each location uses its own name.

If no Sellable Variants exist, the form says to create them on the plant first and does not submit.

A variant-backed Offer shows its variant as text on edit. Price, status, and availability stay editable. `sellableVariantId` and `productId` are immutable. Expanded detail shows the variant and the saved contexts. The collapsed card stays plant name, price, and status. Supplier cost is omitted.

`/admin/offers/flowers` keeps plant, consumer price, and status.

English and Hebrew copy was added for the variant label, Catalog, partner locations, the empty-variant message, the reuse message, and the two `409` errors. Those errors use the existing error line.

---

## 8. Authorization

`GET /api/offers`, `POST /api/offers`, and `PATCH /api/offers/[offerId]` use `isAdminRequest` and return `401` without the admin cookie. The only HTTP caller is `AdminOffersManager`.

Shop, cart, checkout, and POS do not call `GET /api/offers`. They still call `readOffers()` and `getOfferById()` directly. `GET /api/sellable-variants` is admin-only.

---

## 9. What stayed on the current path

These still read `offer.variantId` (`offers.variant_id`) and were not switched to the Sellable Variant:

- `lib/posOccupancy.ts`
- `components/admin/AdminPosSpotEditForm.tsx`
- `components/admin/AdminQrGenerator.tsx`
- `components/admin/AdminPartnerDetail.tsx`

`lib/posLandingRead.ts` still maps the offer row. `OfferRow` stayed exported for that read. New Offers leave `variant_id` null, so POS still asks the operator for the plant size.

Shop and cart still use `catalog_price`. Checkout and holds still use the cart’s plant size and pot variant. POS payment still uses `offers.consumer_price` and `pos_spots.current_offer_id`.

Not in this slice: Slice 5, Slice 6, Catalog cutover, cart changes, holds, POS placement, partner customer flow, Cycle, Segment, and analytics.

---

## 10. Migration runner

`scripts/apply-sql-file.mjs` splits SQL on semicolons only outside single quotes, `''` escapes, `$$`, and `$tag$`. It drops `--` line comments only outside those quotes. `BEGIN` and `COMMIT` stay skipped. This is a generic scanner, not a special case for `048`.

The copies in `scripts/run-migration.mjs` and `scripts/migrate-plants-from-json.mjs` were not changed. `npm run db:migrate` was not run.

Regression: every migration through `047` produces the same statement list as the old strip-then-split scanner, including the semicolon inside a `--` comment in `001_initial_schema.sql`. `048` stays 11 statements. The old scanner splits it into 72. Both function bodies stay intact.

The runner has no migration-number rule and no dev-host rule. A pre-commit pass removed the temporary `048` host check. Applying `048` only to `dev-partner-page` (`br-fancy-paper-alkcqgiz`, host `ep-snowy-credit-alavcarh-pooler.c-3.eu-central-1.aws.neon.tech`) remains an execution decision.

---

## 11. Files

Added:

- `db/migrations/048_offers_on_sellable_variants.sql`
- `app/api/sellable-variants/route.ts`
- `scripts/verify-offer-variants.ts`
- `docs/slice-4-work-summary.md`

Changed:

- `scripts/apply-sql-file.mjs`
- `lib/offerTypes.ts`
- `lib/offerStorage.ts`
- `lib/sellableVariantStorage.ts`
- `lib/routes.ts`
- `lib/messages.ts`
- `lib/displayLabels.ts`
- `app/api/offers/route.ts`
- `app/api/offers/[offerId]/route.ts`
- `components/admin/AdminOffersManager.tsx`
- `scripts/verify-sellable-variants.ts`
- `scripts/verify-plant-variants-schema.ts`
- `package.json` (`verify:offer-variants`)

`verify-sellable-variants` no longer forbids `sellable_variants` inside `lib/offerStorage.ts`. That guard is now shop, cart, and `lib/posSpotStorage.ts`. `verify-plant-variants-schema` no longer calls `appendOffer` for a plant. Its direct SQL for the legacy `offers.variant_id` foreign key stays.

A later pass protected `GET /api/offers` and removed the temporary `048` host check from the runner. No UI file changed in that pass.

---

## 12. Verification

All exited 0:

- `node node_modules/typescript/bin/tsc --noEmit`
- `verify-offer-variants`
- `verify-sellable-variants`
- `verify-pot-sizes-colors`
- `verify-admin-catalog-inventory`
- `verify-catalog-shop`
- `verify-catalog-cart`
- `verify-catalog-checkout-ui`
- `verify-flowers-phase1`
- `verify-routes-smoke`
- `verify-plant-variants-schema`

`verify-offer-variants` covers no-pot and pot Offers, product derived from the variant, a mismatched product, null legacy `variant_id` on new plant Offers, blank price rejected, explicit `0`, supplier cost not used as the selling price, Catalog, one location, several locations, Catalog plus locations, duplicate and malformed availability, reuse including status and added contexts, a `409` that rolls back, a different price, edit onto a duplicate price, a second active Catalog Offer, an inactive Catalog Offer beside an active one, concurrent Catalog attempts, concurrent same-variant same-price creates, flower rejection, a referenced Sellable Variant that cannot be deleted, a referenced Partner Location that cannot be deleted, admin auth on GET, POST, and PATCH, and the migration-parser regression, including the absence of `048` or dev-host logic in the runner.

`verify-routes-smoke` ran against the local app. POS occupancy was unchanged. `/admin/offers/plants`, `/admin/offers/flowers`, and `/shop` each returned 200. The variant form was not clicked through in a browser. Create, reuse, rollback, auth, and flower behavior were exercised through the route handlers and the database.

---

## 13. Commit

Committed on `catalog/offers-on-sellable-variants` as `Add variant-backed offer availability`. Not merged, pushed, or deployed. Production and local `master` were not changed.
