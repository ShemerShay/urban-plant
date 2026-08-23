-- Additive Hebrew catalog copy. English columns are unchanged.

BEGIN;

ALTER TABLE plants
  ADD COLUMN IF NOT EXISTS name_he text,
  ADD COLUMN IF NOT EXISTS subtitle_he text,
  ADD COLUMN IF NOT EXISTS description_he text,
  ADD COLUMN IF NOT EXISTS water_he text;

COMMIT;
