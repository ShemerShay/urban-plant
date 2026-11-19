-- Difficulty is obsolete. Drop the column without preserving its values.
-- Pet friendly stays on plants.pet_friendly.

BEGIN;

ALTER TABLE plants
  DROP CONSTRAINT IF EXISTS plants_plants_required_content;

ALTER TABLE plants
  ADD CONSTRAINT plants_plants_required_content CHECK (
    inventory_type <> 'plants'
    OR (
      subtitle IS NOT NULL AND length(trim(subtitle)) > 0
      AND description IS NOT NULL AND length(trim(description)) > 0
      AND water IS NOT NULL AND length(trim(water)) > 0
      AND location IS NOT NULL AND length(trim(location)) > 0
      AND light IS NOT NULL
      AND pet_friendly IS NOT NULL
      AND images IS NOT NULL
      AND jsonb_typeof(images) = 'array'
      AND jsonb_array_length(images) > 0
      AND labels IS NOT NULL
      AND jsonb_typeof(labels) = 'array'
      AND jsonb_array_length(labels) > 0
      AND care_instructions IS NOT NULL
      AND jsonb_typeof(care_instructions) = 'array'
      AND jsonb_array_length(care_instructions) > 0
    )
  );

ALTER TABLE plants DROP CONSTRAINT IF EXISTS plants_difficulty_check;
ALTER TABLE plants DROP COLUMN IF EXISTS difficulty;

COMMIT;
