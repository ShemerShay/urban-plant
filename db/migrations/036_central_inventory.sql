-- Phase 1.4: Urban Plant central Back Office inventory (variant-based).
-- One current quantity row per variant, plus append-only history.
-- No Partner/location buckets. No seed from POS. Flowers are excluded in app writers.

BEGIN;

CREATE TABLE IF NOT EXISTS inventory (
  variant_id  uuid PRIMARY KEY REFERENCES plant_variants (id),
  quantity    integer NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_quantity_non_negative CHECK (quantity >= 0)
);

CREATE TABLE IF NOT EXISTS inventory_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  uuid NOT NULL REFERENCES plant_variants (id),
  delta       integer NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_history_delta_nonzero CHECK (delta <> 0)
);

CREATE INDEX IF NOT EXISTS inventory_history_variant_created_at_idx
  ON inventory_history (variant_id, created_at DESC);

COMMIT;
