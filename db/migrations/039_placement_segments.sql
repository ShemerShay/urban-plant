-- Placement Segment: one continuous exposure configuration inside a Placement Cycle.
-- Snapshots pocket, offer, and consumer price. Does not backfill closed Cycles.
-- Open Cycles get one Segment at go-live (started_at = now()), not at Cycle start.
-- A missing Pocket row or a blank Pocket name does not skip the Cycle.
-- pocket_id is copied from the POS; pocket_name is null when it is missing or unusable.

BEGIN;

CREATE TABLE IF NOT EXISTS placement_segments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_cycle_id  uuid NOT NULL,
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  pocket_id           uuid,
  pocket_name         text,
  offer_id            text NOT NULL,
  consumer_price      numeric(10, 2) NOT NULL,
  CONSTRAINT placement_segments_cycle_fkey
    FOREIGN KEY (placement_cycle_id) REFERENCES placement_cycles (id) ON DELETE RESTRICT,
  CONSTRAINT placement_segments_offer_fkey
    FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE RESTRICT,
  CONSTRAINT placement_segments_ended_after_start_check
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT placement_segments_pocket_pair_check
    CHECK (
      pocket_name IS NULL
      OR (
        pocket_id IS NOT NULL
        AND length(trim(pocket_name)) > 0
      )
    )
);

-- Already-applied databases keep the previous check until this replace runs.
ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_pocket_pair_check;

ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_pocket_pair_check
  CHECK (
    pocket_name IS NULL
    OR (
      pocket_id IS NOT NULL
      AND length(trim(pocket_name)) > 0
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS placement_segments_one_open_per_cycle
  ON placement_segments (placement_cycle_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS placement_segments_cycle_started_idx
  ON placement_segments (placement_cycle_id, started_at);

INSERT INTO placement_segments (
  placement_cycle_id,
  started_at,
  ended_at,
  pocket_id,
  pocket_name,
  offer_id,
  consumer_price
)
SELECT
  c.id,
  now(),
  NULL,
  p.pocket_id,
  CASE
    WHEN pk.name IS NOT NULL AND length(trim(pk.name)) > 0 THEN pk.name
    ELSE NULL
  END,
  p.current_offer_id,
  o.consumer_price
FROM placement_cycles c
INNER JOIN pos_spots p ON p.id = c.pos_spot_id
INNER JOIN offers o ON o.id = p.current_offer_id
LEFT JOIN pockets pk ON pk.id = p.pocket_id
WHERE c.ended_at IS NULL
  AND o.consumer_price IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM placement_segments s
    WHERE s.placement_cycle_id = c.id
      AND s.ended_at IS NULL
  );

COMMIT;
