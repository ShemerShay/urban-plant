-- Pot → Pot Size → Color, plus central inventory per color.
-- Legacy pot_variants stays in place for the current Catalog.
-- Supplier cost is not copied from the legacy selling price.
-- Color ids reuse pot_variants.id when a legacy row exists.
-- No inventory rows are seeded: a missing balance is 0.

BEGIN;

CREATE TABLE IF NOT EXISTS pot_sizes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pot_id          uuid NOT NULL REFERENCES pots (id) ON DELETE CASCADE,
  size_label      text NOT NULL,
  supplier_price  numeric(10, 2),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pot_sizes_size_label_sml
    CHECK (size_label IN ('S', 'M', 'L')),
  CONSTRAINT pot_sizes_supplier_price_positive
    CHECK (supplier_price IS NULL OR supplier_price > 0),
  CONSTRAINT pot_sizes_pot_size_key
    UNIQUE (pot_id, size_label)
);

CREATE TABLE IF NOT EXISTS pot_colors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pot_size_id  uuid NOT NULL REFERENCES pot_sizes (id) ON DELETE CASCADE,
  color        text NOT NULL,
  color_he     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pot_colors_color_not_blank
    CHECK (length(trim(color)) > 0),
  CONSTRAINT pot_colors_color_he_not_blank
    CHECK (color_he IS NULL OR length(trim(color_he)) > 0),
  CONSTRAINT pot_colors_size_color_key
    UNIQUE (pot_size_id, color)
);

CREATE TABLE IF NOT EXISTS pot_inventory (
  pot_color_id  uuid PRIMARY KEY REFERENCES pot_colors (id),
  quantity      integer NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pot_inventory_quantity_non_negative CHECK (quantity >= 0)
);

CREATE TABLE IF NOT EXISTS pot_inventory_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pot_color_id  uuid NOT NULL REFERENCES pot_colors (id),
  delta         integer NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pot_inventory_history_delta_nonzero CHECK (delta <> 0)
);

CREATE INDEX IF NOT EXISTS pot_sizes_pot_id_idx
  ON pot_sizes (pot_id);

CREATE INDEX IF NOT EXISTS pot_colors_pot_size_id_idx
  ON pot_colors (pot_size_id);

CREATE INDEX IF NOT EXISTS pot_inventory_history_color_created_at_idx
  ON pot_inventory_history (pot_color_id, created_at DESC);

INSERT INTO pot_sizes (pot_id, size_label, supplier_price)
SELECT DISTINCT pv.pot_id, pv.size_label, NULL::numeric(10, 2)
FROM pot_variants pv
WHERE NOT EXISTS (
  SELECT 1
  FROM pot_sizes ps
  WHERE ps.pot_id = pv.pot_id
    AND ps.size_label = pv.size_label
);

INSERT INTO pot_colors (id, pot_size_id, color, color_he)
SELECT pv.id, ps.id, btrim(pv.color), NULLIF(btrim(pv.color_he), '')
FROM pot_variants pv
INNER JOIN pot_sizes ps
  ON ps.pot_id = pv.pot_id
 AND ps.size_label = pv.size_label
WHERE NOT EXISTS (
  SELECT 1
  FROM pot_colors c
  WHERE c.id = pv.id
)
AND NOT EXISTS (
  SELECT 1
  FROM pot_colors c
  WHERE c.pot_size_id = ps.id
    AND lower(btrim(c.color)) = lower(btrim(pv.color))
);

CREATE UNIQUE INDEX IF NOT EXISTS pot_colors_size_color_folded_key
  ON pot_colors (pot_size_id, lower(btrim(color)));

ALTER TABLE pot_colors DROP CONSTRAINT IF EXISTS pot_colors_color_trimmed;

ALTER TABLE pot_colors ADD CONSTRAINT pot_colors_color_trimmed
  CHECK (
    color = btrim(color)
    AND (color_he IS NULL OR color_he = btrim(color_he))
  );

COMMIT;
