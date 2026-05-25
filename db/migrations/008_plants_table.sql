-- Plant catalog: migrate from data/plants.json (price → supplier_price)

BEGIN;

CREATE TABLE IF NOT EXISTS plants (
  id                      text PRIMARY KEY,
  name                    text NOT NULL,
  family                  text,
  subtitle                text NOT NULL,
  description             text NOT NULL,
  supplier_price          numeric(10, 2) NOT NULL,
  currency                text NOT NULL,
  images                  jsonb NOT NULL,
  labels                  jsonb NOT NULL,
  light                   text NOT NULL,
  water                   text NOT NULL,
  average_size            text,
  maintenance_conditions  text,
  supplier_name           text,
  difficulty              text NOT NULL,
  location                text NOT NULL,
  pet_friendly            boolean NOT NULL DEFAULT false,
  care_instructions       jsonb NOT NULL,
  commercial_copy         text NOT NULL,
  created_at              timestamptz,
  CONSTRAINT plants_currency_check
    CHECK (currency IN ('ILS', 'USD', 'EUR')),
  CONSTRAINT plants_difficulty_check
    CHECK (difficulty IN ('Easy', 'Moderate', 'Advanced')),
  CONSTRAINT plants_light_check
    CHECK (light IN ('Low light', 'Indirect bright light', 'Full sun')),
  CONSTRAINT plants_average_size_check
    CHECK (average_size IS NULL OR average_size IN ('small', 'medium', 'large')),
  CONSTRAINT plants_supplier_price_nonneg
    CHECK (supplier_price >= 0),
  CONSTRAINT plants_images_is_array
    CHECK (jsonb_typeof(images) = 'array'),
  CONSTRAINT plants_labels_is_array
    CHECK (jsonb_typeof(labels) = 'array'),
  CONSTRAINT plants_care_instructions_is_array
    CHECK (jsonb_typeof(care_instructions) = 'array')
);

CREATE INDEX IF NOT EXISTS plants_name_idx ON plants (name);

COMMIT;
