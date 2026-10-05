-- Catalog pots for public browsing. Size match is exact size_label (S/M/L).
-- No pot inventory, no compatibility table, no plant-variant schema change.

BEGIN;

CREATE TABLE IF NOT EXISTS pots (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  name_he   text,
  image     text,
  CONSTRAINT pots_name_not_blank
    CHECK (length(trim(name)) > 0),
  CONSTRAINT pots_name_he_not_blank
    CHECK (name_he IS NULL OR length(trim(name_he)) > 0),
  CONSTRAINT pots_image_not_blank
    CHECK (image IS NULL OR length(trim(image)) > 0)
);

CREATE TABLE IF NOT EXISTS pot_variants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pot_id         uuid NOT NULL REFERENCES pots (id) ON DELETE CASCADE,
  size_label     text NOT NULL,
  color          text NOT NULL,
  color_he       text,
  catalog_price  numeric(10, 2) NOT NULL,
  CONSTRAINT pot_variants_size_label_sml
    CHECK (size_label IN ('S', 'M', 'L')),
  CONSTRAINT pot_variants_color_not_blank
    CHECK (length(trim(color)) > 0),
  CONSTRAINT pot_variants_color_he_not_blank
    CHECK (color_he IS NULL OR length(trim(color_he)) > 0),
  CONSTRAINT pot_variants_catalog_price_positive
    CHECK (catalog_price > 0),
  CONSTRAINT pot_variants_pot_size_color_key
    UNIQUE (pot_id, size_label, color)
);

CREATE INDEX IF NOT EXISTS pot_variants_pot_id_idx
  ON pot_variants (pot_id);

CREATE INDEX IF NOT EXISTS pot_variants_size_label_idx
  ON pot_variants (size_label);

COMMIT;
