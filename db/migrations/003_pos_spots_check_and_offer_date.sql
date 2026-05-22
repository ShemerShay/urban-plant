-- pos_spots: replace maintenance timestamps with check fields; rename placed_at → offer_placed_at
-- Preserves placed_at values as offer_placed_at. Backfills check fields from legacy "checked" maintenance only.

BEGIN;

ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS offer_placed_at timestamptz;

UPDATE pos_spots SET offer_placed_at = placed_at WHERE offer_placed_at IS NULL;

ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS check_status boolean NOT NULL DEFAULT false;
ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS check_by text;
ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS next_check date;
ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS pos_weekly_note text;

UPDATE pos_spots
SET
  check_status = true,
  check_by = NULLIF(TRIM(last_handled_by), ''),
  next_check = (COALESCE((last_checked_at AT TIME ZONE 'UTC')::date, CURRENT_DATE) + 7)::date
WHERE latest_maintenance_status = 'checked';

ALTER TABLE pos_spots DROP CONSTRAINT IF EXISTS pos_spots_maintenance_status_check;

ALTER TABLE pos_spots DROP COLUMN IF EXISTS placed_at;
ALTER TABLE pos_spots DROP COLUMN IF EXISTS latest_maintenance_status;
ALTER TABLE pos_spots DROP COLUMN IF EXISTS last_checked_at;
ALTER TABLE pos_spots DROP COLUMN IF EXISTS last_watered_at;
ALTER TABLE pos_spots DROP COLUMN IF EXISTS last_handled_at;
ALTER TABLE pos_spots DROP COLUMN IF EXISTS last_handled_by;

COMMIT;
