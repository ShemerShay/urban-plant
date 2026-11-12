-- Sellable Variant = Plant Size + optional Pot Size.
-- No-pot is a real row (pot_size_id NULL). One no-pot row per Plant Size.
-- No selling price, no inventory, and no copied combinations.

BEGIN;

CREATE TABLE IF NOT EXISTS sellable_variants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_variant_id   uuid NOT NULL REFERENCES plant_variants (id) ON DELETE RESTRICT,
  pot_size_id        uuid REFERENCES pot_sizes (id) ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sellable_variants_plant_size_pot_size_key
    UNIQUE NULLS NOT DISTINCT (plant_variant_id, pot_size_id)
);

CREATE INDEX IF NOT EXISTS sellable_variants_pot_size_id_idx
  ON sellable_variants (pot_size_id);

COMMIT;
