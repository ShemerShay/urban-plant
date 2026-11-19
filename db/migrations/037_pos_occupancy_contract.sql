-- Slice A: POS occupancy contract.
-- Physical plant identity lives on pos_spots.plant_variant_id (nullable, no backfill).
-- current_offer_id may be null after Remove so a slot can be empty while QR/POS remain.
-- Occupying a variant still requires an offer. Legacy offer-only rows stay valid.

BEGIN;

ALTER TABLE pos_spots
  ADD COLUMN IF NOT EXISTS plant_variant_id uuid;

ALTER TABLE pos_spots
  DROP CONSTRAINT IF EXISTS pos_spots_plant_variant_id_fkey;

ALTER TABLE pos_spots
  ADD CONSTRAINT pos_spots_plant_variant_id_fkey
  FOREIGN KEY (plant_variant_id) REFERENCES plant_variants (id);

CREATE INDEX IF NOT EXISTS pos_spots_plant_variant_id_idx
  ON pos_spots (plant_variant_id)
  WHERE plant_variant_id IS NOT NULL;

ALTER TABLE pos_spots
  ALTER COLUMN current_offer_id DROP NOT NULL;

ALTER TABLE pos_spots
  DROP CONSTRAINT IF EXISTS pos_spots_occupancy_offer_when_variant;

ALTER TABLE pos_spots
  ADD CONSTRAINT pos_spots_occupancy_offer_when_variant
  CHECK (plant_variant_id IS NULL OR current_offer_id IS NOT NULL);

COMMIT;
