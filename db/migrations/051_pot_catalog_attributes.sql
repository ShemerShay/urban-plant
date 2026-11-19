-- Catalog attributes for a distinct pot model.
-- Each photo, diameter, and finish stays on pots.
-- pot_sizes remains S/M/L and is not used for centimetre diameters.
-- No prices, stock, or pot_colors rows are created here.

BEGIN;

ALTER TABLE pots
  ADD COLUMN IF NOT EXISTS family text,
  ADD COLUMN IF NOT EXISTS diameter_cm numeric(6, 2),
  ADD COLUMN IF NOT EXISTS material text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS form text,
  ADD COLUMN IF NOT EXISTS texture text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE pots DROP CONSTRAINT IF EXISTS pots_family_not_blank;
ALTER TABLE pots
  ADD CONSTRAINT pots_family_not_blank
  CHECK (family IS NULL OR length(btrim(family)) > 0);

ALTER TABLE pots DROP CONSTRAINT IF EXISTS pots_diameter_cm_positive;
ALTER TABLE pots
  ADD CONSTRAINT pots_diameter_cm_positive
  CHECK (diameter_cm IS NULL OR diameter_cm > 0);

ALTER TABLE pots DROP CONSTRAINT IF EXISTS pots_material_trimmed;
ALTER TABLE pots
  ADD CONSTRAINT pots_material_trimmed
  CHECK (material IS NULL OR (material = btrim(material) AND length(material) > 0));

ALTER TABLE pots DROP CONSTRAINT IF EXISTS pots_color_trimmed;
ALTER TABLE pots
  ADD CONSTRAINT pots_color_trimmed
  CHECK (color IS NULL OR (color = btrim(color) AND length(color) > 0));

ALTER TABLE pots DROP CONSTRAINT IF EXISTS pots_form_check;
ALTER TABLE pots
  ADD CONSTRAINT pots_form_check
  CHECK (form IS NULL OR form IN ('classic', 'tall', 'bowl'));

ALTER TABLE pots DROP CONSTRAINT IF EXISTS pots_texture_trimmed;
ALTER TABLE pots
  ADD CONSTRAINT pots_texture_trimmed
  CHECK (texture IS NULL OR (texture = btrim(texture) AND length(texture) > 0));

CREATE UNIQUE INDEX IF NOT EXISTS pots_family_diameter_color_key
  ON pots (family, diameter_cm, color)
  WHERE family IS NOT NULL
    AND diameter_cm IS NOT NULL
    AND color IS NOT NULL;

COMMIT;
