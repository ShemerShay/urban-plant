-- Phase 1.3: plant variants as a physical configuration layer.
-- Offers keep product_id. variant_id is nullable; no backfill.
-- Composite FK enforces Offer product_id = Variant plant_id when variant_id is set.
-- MATCH SIMPLE leaves existing NULL variant_id rows (including the manual offer) valid.

BEGIN;

CREATE TABLE IF NOT EXISTS plant_variants (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id                    text NOT NULL REFERENCES plants (id),
  size_label                  text,
  nursery_pot_diameter_cm     numeric(6, 2),
  CONSTRAINT plant_variants_size_label_not_blank
    CHECK (size_label IS NULL OR length(trim(size_label)) > 0),
  CONSTRAINT plant_variants_nursery_pot_diameter_positive
    CHECK (nursery_pot_diameter_cm IS NULL OR nursery_pot_diameter_cm > 0)
);

-- Supporting unique for the composite offer FK. Does not unique plant_id.
CREATE UNIQUE INDEX IF NOT EXISTS plant_variants_id_plant_id_key
  ON plant_variants (id, plant_id);

CREATE INDEX IF NOT EXISTS plant_variants_plant_id_idx
  ON plant_variants (plant_id);

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS variant_id uuid;

ALTER TABLE offers
  DROP CONSTRAINT IF EXISTS offers_variant_product_fkey;

ALTER TABLE offers
  ADD CONSTRAINT offers_variant_product_fkey
  FOREIGN KEY (variant_id, product_id)
  REFERENCES plant_variants (id, plant_id);

CREATE INDEX IF NOT EXISTS offers_variant_id_idx
  ON offers (variant_id)
  WHERE variant_id IS NOT NULL;

COMMIT;
