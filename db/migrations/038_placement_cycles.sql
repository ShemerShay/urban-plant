-- Placement Cycle: lifetime of one physical plant unit on one POS.
-- Empty table. Do not backfill existing occupancy.

BEGIN;

CREATE TABLE IF NOT EXISTS placement_cycles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_spot_id       uuid NOT NULL,
  plant_variant_id  uuid NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  end_reason        text,
  order_id          uuid,
  CONSTRAINT placement_cycles_pos_spot_id_fkey
    FOREIGN KEY (pos_spot_id) REFERENCES pos_spots (id) ON DELETE RESTRICT,
  CONSTRAINT placement_cycles_plant_variant_id_fkey
    FOREIGN KEY (plant_variant_id) REFERENCES plant_variants (id) ON DELETE RESTRICT,
  CONSTRAINT placement_cycles_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE RESTRICT,
  CONSTRAINT placement_cycles_end_pair_check
    CHECK (
      (ended_at IS NULL AND end_reason IS NULL)
      OR (ended_at IS NOT NULL AND end_reason IS NOT NULL)
    ),
  CONSTRAINT placement_cycles_end_reason_check
    CHECK (
      end_reason IS NULL
      OR end_reason IN ('sold', 'removed', 'replaced', 'deactivated')
    ),
  CONSTRAINT placement_cycles_order_id_sold_check
    CHECK (order_id IS NULL OR end_reason = 'sold'),
  CONSTRAINT placement_cycles_ended_after_start_check
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS placement_cycles_one_open_per_pos
  ON placement_cycles (pos_spot_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS placement_cycles_pos_started_idx
  ON placement_cycles (pos_spot_id, started_at);

CREATE INDEX IF NOT EXISTS placement_cycles_variant_started_idx
  ON placement_cycles (plant_variant_id, started_at);

COMMIT;
