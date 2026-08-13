-- POS watering: track when a spot's plant was last watered (no history table).

BEGIN;

ALTER TABLE pos_spots
  ADD COLUMN IF NOT EXISTS last_watered_at timestamptz;

COMMIT;
