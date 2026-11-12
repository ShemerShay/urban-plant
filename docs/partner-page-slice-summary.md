# Partner Page slice — work summary

Branch: `catalog/partner-page` (worktree `urban-plant-partner-page`)
HEAD: `464a160` (Merge catalog admin shell slice) — **nothing committed on top yet**
Parent project: Catalog / Analytics / Infrastructure (`catalog-analytics-infrastructure-changes`, plan in `docs/catalog-analytics-infrastructure.md`)

Status as of 2026-09-26: all Partner work is uncommitted, compiles, and passes the Partner verification. Not pushed, merged, deployed, or migrated to production.

---

## 1. Timeline

1. **Read-only audit.** Admin shell (Phase A, `b5ccaca`) was already merged into the parent branch. The Partner page existed only as uncommitted work in the `catalog/partner-page` worktree. Phases B–H not started.
2. **Run the worktree locally.** Turbopack panics because the worktree's `node_modules` is a junction, so the dev server must run with `npx next dev --webpack -p 3000`.
3. **"Old page showing" diagnosis.** The browser was on the Desktop checkout (port 3001), and the draft `/api/partners` returned 500 because `monthly_revenue` / `notes` columns did not exist in the DB.
4. **Mock profile.** Migration renamed to `031_partner_profile_fields.sql`; UI temporarily showed mock revenue/notes (later removed).
5. **Neon dev branch.** A dev branch was created from production; only this worktree's `.env.local` points at it. Migrations 031 and 032 applied there only.
6. **Partner → Locations hierarchy, counts, logo.**
7. **UI tweaks.** Removed the "Alon Shabo · Location" eyebrow; made Notes / Pockets / POS spots collapsible accordions, folded by default.
8. **Finishing pass.** Added manual `setup_cost`, fixed the slice's new lint issues, reviewed `GET /api/pos-spots`.
9. **Offer-status concern.** An attempt to add an `includeInactiveOffers` option was interrupted mid-edit and left `tsc` broken.
10. **Decision: Offer active/inactive status is not Partner business logic.** Interrupted approach removed; Partner page now resolves plant metadata per POS row without any Offer-status filter.

---

## 2. Locked Partner behavior

Hierarchy: **Partner → Locations → Location detail → Pockets → Plant groups → POS**

Plant counting (Pocket, Plant group, and location totals):

| POS status | Meaning |
|---|---|
| `available` | active |
| `sold` | unavailable |
| `inactive` | unavailable |
| `held_for_payment` | excluded completely |
| flowers (any status) | excluded completely |

`active / total = available / (available + sold + inactive)`

- Pocket label: `23/40 active plants`; Plant group badge: `Dracaena Marginata — 4/6`.
- Opening a Plant group shows available, sold, and inactive POS rows; never `held_for_payment`.
- The source of truth is the POS rows. **Offer active/inactive status is not used.**

Other locked decisions:

- Existing location IDs and brand-prefixed location names stay unchanged (analytics filters on `%alon shabo%` and on IDs).
- Monthly revenue and setup cost are manual, persisted values.
- Notes is one editable field, updated in place; the visit checklist is fixed read-only copy.
- Partner logo lives on `partners.image`; `partner_locations.image` is left untouched and unused.
- API names unchanged: `/api/partners` = locations, `/api/partner-brands` = partners.

---

## 3. Data model

- **New table `partners`** (brand): `id`, `name` (non-blank), `image`, `created_at`.
- **`partner_locations.partner_id`** — required FK to `partners`, indexed.
- Migration 032 creates partner `alon-shabo` and links both Alon Shabo locations by ID (no name parsing). Every other location becomes its own partner with the same ID, so old single-location links still land correctly.
- **`partner_locations`** also gains `monthly_revenue`, `setup_cost` (both `numeric(12,2)`, default 0, non-negative checks) and `notes` (text, default `''`) in migration 031.
- Nothing that references locations changed: pockets, POS, orders, payments, events, and analytics keep working.

Migrations:

| File | Contents | Applied |
|---|---|---|
| `db/migrations/031_partner_profile_fields.sql` | `monthly_revenue`, `setup_cost`, `notes` + checks | Neon dev branch only |
| `db/migrations/032_partners.sql` | `partners` table, `partner_id` link + backfill | Neon dev branch only |

npm scripts: `db:migrate:partner-profile`, `db:migrate:partners`, `verify:partner-page`.

---

## 4. Routes and UI

| URL | Shows |
|---|---|
| `/admin/partners` | Partner list (logo, location count, location names), create partner |
| `/admin/partners/{partnerId}` | Partner header (logo, name, edit name + logo) and its Locations list |
| `/admin/partners/{partnerId}/locations/{locationId}` | Location detail |
| `/admin/partners/{locationId}` (legacy) | Redirects to the nested location URL |

Location detail page:

- Header: partner logo, location name, address, type, "Back to {partner}" link.
- Cards: Monthly revenue, Setup cost, Active plants (`available/total`).
- Accordions (folded by default): Notes (fixed checklist + editable note), Pockets (→ Plant groups → POS rows), POS spots (full list).
- One profile modal edits monthly revenue, setup cost, and notes via `PATCH /api/partners/{locationId}`.

Partner logo upload reuses the existing `PlantImagePicker` + `/api/plant-images`; image must be a site path or `https://` URL.

---

## 5. Partner POS data flow (final)

1. Location page calls `GET /api/pos-spots?partnerId={locationId}`.
2. The route returns every POS row for that location (filtered only by location; stale holds are expired first).
3. The route also returns **`spotOffers`**: one entry per offer referenced by those rows — product name, product id (grouping key), and `inventoryType` — built by `resolveSpotOffers` in `lib/partnerPlantSummary.ts`. It never reads Offer status.
4. If an offer or its catalog product can't be resolved, `inventoryType` is `null` (not defaulted to plants). Such rows are left out of plant counts/groups, but still appear in the full POS spots list.
5. The page counts with `isCountedPlantSpot` (status available/sold/inactive **and** `inventoryType === "plants"`) and `countPlantSpots`, and groups with `groupPlantSpotsByType`.
6. The existing `offers` list (active, non-manual) is unchanged and used only for the create/edit POS dropdowns, so other callers of `GET /api/pos-spots` keep their behavior.

---

## 6. Verification (latest run)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass |
| `npm run verify:partner-page` | pass |
| `npx tsx scripts/verify-admin-shell.ts` | pass |
| `npx tsx scripts/verify-pos-spot-sort.ts` | pass |
| eslint on slice files | no new errors; 6 errors pre-exist on HEAD (4 in `AdminPartnerDetail.tsx`, 2 in `AdminPartnersManager.tsx`) |
| `verify-locale-foundation` | fails on HEAD (`LanguageSwitcher` moved by admin shell) — outside this slice |

`verify:partner-page` covers available, sold, inactive, held, flower, POS rows on an **inactive offer** (still counted and grouped), and rows with a missing product or offer (excluded). Expected: location 3/7, pocket 3/6, Dracaena 2/5 (active + inactive offers grouped together), Ficus 1/1; opened groups contain available, sold, inactive, never held.

Earlier live checks on the dev branch: Chlenov = 51/64 (6 flower POS excluded), setup cost round-trip and negative rejection, brand logo PATCH, page routes and legacy redirect all worked. The latest `spotOffers` change has not yet been checked live (port 3000 currently serves the Desktop checkout).

---

## 7. Files

Modified: `app/admin/partners/[partnerId]/page.tsx`, `app/admin/partners/page.tsx`, `app/api/partners/[partnerId]/route.ts`, `app/api/partners/route.ts`, `app/api/pos-spots/route.ts`, `components/admin/AdminPartnerDetail.tsx`, `components/admin/AdminPartnersManager.tsx`, `components/admin/shared/AdminManagementSection.tsx`, `docs/catalog-analytics-infrastructure.md`, `lib/messages.ts`, `lib/partnerLocationStorage.ts`, `lib/partnerValidation.ts`, `lib/routes.ts`, `package.json`, `scripts/seed-from-json.mjs`

New: `app/admin/partners/[partnerId]/locations/[locationId]/page.tsx`, `app/api/partner-brands/route.ts`, `app/api/partner-brands/[brandId]/route.ts`, `components/admin/AdminPartnerBrands.tsx`, `db/migrations/031_partner_profile_fields.sql`, `db/migrations/032_partners.sql`, `lib/partnerBrandValidation.ts`, `lib/partnerPlantSummary.ts`, `lib/partnerStorage.ts`, `scripts/verify-partner-page.mjs`, `docs/partner-page-slice-summary.md` (this file)

---

## 8. Remaining before commit / merge

- Live check of the latest `spotOffers` change: run the worktree server (`npx next dev --webpack -p <port>`) against the Neon dev branch.
- Apply migrations 031 and 032 to production before merging (otherwise `/api/partners` fails there).
- Restore this worktree's `.env.local` to production from `.env.production-db.local` when done with the dev branch.
- Minor: legacy POS-spot admin redirects to `/admin/partners/{locationId}` land on the Partner page (not the location) for single-location partners.
- Open product decisions: whether to drop the unused `partner_locations.image`; whether flower POS should be shown/counted separately later.

## 9. Standing constraints

- Work only on `catalog/partner-page`; no Catalog, inventory, cart, checkout, Cardcom, flower flow, or analytics implementation.
- Do not commit, push, merge, deploy, or touch production without explicit approval.
- Do not change global POS/payment behavior; do not fake grouping by parsing names.
- Neon destructive operations only with explicit user approval.
