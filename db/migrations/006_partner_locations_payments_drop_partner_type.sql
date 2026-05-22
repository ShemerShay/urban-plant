-- partner_locations: drop duplicate partner_type, add payments ledger (jsonb array)

BEGIN;

-- Preserve partner type data: backfill type only when empty
UPDATE partner_locations
SET type = partner_type
WHERE (type IS NULL OR btrim(type) = '')
  AND partner_type IS NOT NULL
  AND btrim(partner_type) <> '';

ALTER TABLE partner_locations
  ADD COLUMN IF NOT EXISTS payments jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE partner_locations
SET payments = '[]'::jsonb
WHERE payments IS NULL;

ALTER TABLE partner_locations
  DROP CONSTRAINT IF EXISTS partner_locations_payments_is_array;

ALTER TABLE partner_locations
  ADD CONSTRAINT partner_locations_payments_is_array
  CHECK (jsonb_typeof(payments) = 'array');

ALTER TABLE partner_locations
  DROP COLUMN IF EXISTS partner_type;

COMMIT;
