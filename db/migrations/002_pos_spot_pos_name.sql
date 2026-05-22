-- Split POS display name from optional description (legacy DBs created before pos_name in 001).
-- New installs: 001 already includes pos_name — this file is idempotent (ADD COLUMN IF NOT EXISTS).
-- Apply: npm run db:migrate:pos-name
BEGIN;

ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS pos_name text;

UPDATE pos_spots
SET pos_name = TRIM(spot_description)
WHERE pos_name IS NULL OR TRIM(pos_name) = '';

ALTER TABLE pos_spots ALTER COLUMN pos_name SET NOT NULL;

ALTER TABLE pos_spots ALTER COLUMN spot_description DROP NOT NULL;

COMMIT;
