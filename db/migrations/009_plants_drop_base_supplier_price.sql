-- Remove base_supplier_price from plants (not persisted).

BEGIN;

ALTER TABLE plants DROP CONSTRAINT IF EXISTS plants_base_supplier_price_nonneg;
ALTER TABLE plants DROP COLUMN IF EXISTS base_supplier_price;

COMMIT;
