-- Remove optional supplier cost/name from offers (kept historically in order snapshots).

BEGIN;

ALTER TABLE offers DROP COLUMN IF EXISTS supplier_price;
ALTER TABLE offers DROP COLUMN IF EXISTS supplier_name;

COMMIT;
