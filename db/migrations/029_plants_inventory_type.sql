-- Catalog inventory type: plants (unique unit, POS sold) vs flowers (reusable POS).
-- Existing rows default to plants. Table name unchanged.

BEGIN;

ALTER TABLE plants
  ADD COLUMN IF NOT EXISTS inventory_type text NOT NULL DEFAULT 'plants';

UPDATE plants
SET inventory_type = 'plants'
WHERE inventory_type IS NULL
   OR inventory_type NOT IN ('plants', 'flowers');

ALTER TABLE plants
  DROP CONSTRAINT IF EXISTS plants_inventory_type_check;

ALTER TABLE plants
  ADD CONSTRAINT plants_inventory_type_check
  CHECK (inventory_type IN ('plants', 'flowers'));

CREATE INDEX IF NOT EXISTS plants_inventory_type_idx ON plants (inventory_type);

COMMIT;
