-- Catalog admin: plant publish flag + independent catalog price on variants.
-- Does not change POS Offer pricing, occupancy, or central inventory writers.

BEGIN;

ALTER TABLE plants
  ADD COLUMN IF NOT EXISTS catalog_published boolean NOT NULL DEFAULT false;

ALTER TABLE plants
  DROP CONSTRAINT IF EXISTS plants_flowers_not_catalog_published;

ALTER TABLE plants
  ADD CONSTRAINT plants_flowers_not_catalog_published
  CHECK (inventory_type IS DISTINCT FROM 'flowers' OR catalog_published = false);

ALTER TABLE plant_variants
  ADD COLUMN IF NOT EXISTS catalog_price numeric(10, 2);

ALTER TABLE plant_variants
  DROP CONSTRAINT IF EXISTS plant_variants_catalog_price_positive;

ALTER TABLE plant_variants
  ADD CONSTRAINT plant_variants_catalog_price_positive
  CHECK (catalog_price IS NULL OR catalog_price > 0);

COMMIT;
