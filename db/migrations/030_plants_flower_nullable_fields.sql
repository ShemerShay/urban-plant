-- Flowers may omit catalog content that plants still require.
-- Plants keep current required fields. Flowers store NULL (not empty strings/arrays).

BEGIN;

ALTER TABLE plants
  ALTER COLUMN subtitle DROP NOT NULL,
  ALTER COLUMN description DROP NOT NULL,
  ALTER COLUMN images DROP NOT NULL,
  ALTER COLUMN labels DROP NOT NULL,
  ALTER COLUMN light DROP NOT NULL,
  ALTER COLUMN water DROP NOT NULL,
  ALTER COLUMN difficulty DROP NOT NULL,
  ALTER COLUMN location DROP NOT NULL,
  ALTER COLUMN pet_friendly DROP NOT NULL,
  ALTER COLUMN care_instructions DROP NOT NULL;

ALTER TABLE plants
  ALTER COLUMN pet_friendly DROP DEFAULT;

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
      AND difficulty IS NOT NULL
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

ALTER TABLE plants
  DROP CONSTRAINT IF EXISTS plants_flowers_null_or_content;

ALTER TABLE plants
  ADD CONSTRAINT plants_flowers_null_or_content CHECK (
    inventory_type <> 'flowers'
    OR (
      (subtitle IS NULL OR length(trim(subtitle)) > 0)
      AND (description IS NULL OR length(trim(description)) > 0)
      AND (water IS NULL OR length(trim(water)) > 0)
      AND (location IS NULL OR length(trim(location)) > 0)
      AND (
        images IS NULL
        OR (jsonb_typeof(images) = 'array' AND jsonb_array_length(images) > 0)
      )
      AND (
        labels IS NULL
        OR (jsonb_typeof(labels) = 'array' AND jsonb_array_length(labels) > 0)
      )
      AND (
        care_instructions IS NULL
        OR (
          jsonb_typeof(care_instructions) = 'array'
          AND jsonb_array_length(care_instructions) > 0
        )
      )
    )
  );

COMMIT;
