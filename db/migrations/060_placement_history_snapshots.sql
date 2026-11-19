-- Placement Cycle & Segment immutable historical snapshots.
-- Preserves partner, location, plant, size, placement_kind, pot label, and
-- placement-time supplier costs without relying on mutable live catalog/POS rows.
-- Plant supplier unit cost is snapshotted once when a Cycle begins
-- (`plants.supplier_price@cycle`) and copied onto later Segments of that Cycle.
-- Pot supplier unit cost is snapshotted when the pot changes
-- (`pots.supplier_price@segment`) and copied when the same pot continues.
-- Supplier costs are never stored on pos_spots.
--
-- Reliability & backfill rule:
--   History prior to cycle tracking (038) and prior to snapshot/cost capture (060)
--   is incomplete. Do NOT invent historical values from mutable live tables:
--   - Open cycles (currently live on a POS) backfill current partner/location/plant/size.
--   - Closed sold cycles backfill only from immutable order snapshots (+ structural plant_id).
--   - Other closed cycles retain NULL for mutable labels/locations and placement_kind.
--   - Pre-060 segments retain NULL supplier costs (never fabricated from current prices).
--   - Legacy Neon `events` remains outside this placement analytics flow.

BEGIN;

ALTER TABLE placement_cycles
  ADD COLUMN IF NOT EXISTS partner_id text,
  ADD COLUMN IF NOT EXISTS partner_name text,
  ADD COLUMN IF NOT EXISTS partner_location_id text,
  ADD COLUMN IF NOT EXISTS partner_location_name text,
  ADD COLUMN IF NOT EXISTS plant_id text,
  ADD COLUMN IF NOT EXISTS plant_name text,
  ADD COLUMN IF NOT EXISTS size_label text,
  ADD COLUMN IF NOT EXISTS placement_kind text;

ALTER TABLE placement_cycles DROP CONSTRAINT IF EXISTS placement_cycles_partner_id_not_blank;
ALTER TABLE placement_cycles
  ADD CONSTRAINT placement_cycles_partner_id_not_blank
  CHECK (partner_id IS NULL OR length(btrim(partner_id)) > 0);

ALTER TABLE placement_cycles DROP CONSTRAINT IF EXISTS placement_cycles_partner_name_not_blank;
ALTER TABLE placement_cycles
  ADD CONSTRAINT placement_cycles_partner_name_not_blank
  CHECK (partner_name IS NULL OR length(btrim(partner_name)) > 0);

ALTER TABLE placement_cycles DROP CONSTRAINT IF EXISTS placement_cycles_partner_location_id_not_blank;
ALTER TABLE placement_cycles
  ADD CONSTRAINT placement_cycles_partner_location_id_not_blank
  CHECK (partner_location_id IS NULL OR length(btrim(partner_location_id)) > 0);

ALTER TABLE placement_cycles DROP CONSTRAINT IF EXISTS placement_cycles_partner_location_name_not_blank;
ALTER TABLE placement_cycles
  ADD CONSTRAINT placement_cycles_partner_location_name_not_blank
  CHECK (partner_location_name IS NULL OR length(btrim(partner_location_name)) > 0);

ALTER TABLE placement_cycles DROP CONSTRAINT IF EXISTS placement_cycles_plant_id_not_blank;
ALTER TABLE placement_cycles
  ADD CONSTRAINT placement_cycles_plant_id_not_blank
  CHECK (plant_id IS NULL OR length(btrim(plant_id)) > 0);

ALTER TABLE placement_cycles DROP CONSTRAINT IF EXISTS placement_cycles_plant_name_not_blank;
ALTER TABLE placement_cycles
  ADD CONSTRAINT placement_cycles_plant_name_not_blank
  CHECK (plant_name IS NULL OR length(btrim(plant_name)) > 0);

ALTER TABLE placement_cycles DROP CONSTRAINT IF EXISTS placement_cycles_size_label_not_blank;
ALTER TABLE placement_cycles
  ADD CONSTRAINT placement_cycles_size_label_not_blank
  CHECK (size_label IS NULL OR length(btrim(size_label)) > 0);

ALTER TABLE placement_cycles DROP CONSTRAINT IF EXISTS placement_cycles_placement_kind_check;
ALTER TABLE placement_cycles
  ADD CONSTRAINT placement_cycles_placement_kind_check
  CHECK (placement_kind IS NULL OR placement_kind IN ('initial', 'restock'));

CREATE INDEX IF NOT EXISTS placement_cycles_partner_started_idx
  ON placement_cycles (partner_id, started_at)
  WHERE partner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS placement_cycles_location_started_idx
  ON placement_cycles (partner_location_id, started_at)
  WHERE partner_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS placement_cycles_plant_started_idx
  ON placement_cycles (plant_id, started_at)
  WHERE plant_id IS NOT NULL;

ALTER TABLE placement_segments
  ADD COLUMN IF NOT EXISTS pot_name text,
  ADD COLUMN IF NOT EXISTS plant_unit_cost numeric(10, 2),
  ADD COLUMN IF NOT EXISTS plant_unit_cost_source text,
  ADD COLUMN IF NOT EXISTS pot_unit_cost numeric(10, 2),
  ADD COLUMN IF NOT EXISTS pot_unit_cost_source text,
  ADD COLUMN IF NOT EXISTS total_supplier_unit_cost numeric(10, 2);

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_pot_name_not_blank;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_pot_name_not_blank
  CHECK (pot_name IS NULL OR length(btrim(pot_name)) > 0);

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_plant_unit_cost_non_negative;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_plant_unit_cost_non_negative
  CHECK (plant_unit_cost IS NULL OR plant_unit_cost >= 0);

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_plant_unit_cost_source_check;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_plant_unit_cost_source_check
  CHECK (
    plant_unit_cost_source IS NULL
    OR plant_unit_cost_source = 'plants.supplier_price@cycle'
  );

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_plant_unit_cost_pair_check;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_plant_unit_cost_pair_check
  CHECK (
    (plant_unit_cost IS NULL AND plant_unit_cost_source IS NULL)
    OR (plant_unit_cost IS NOT NULL AND plant_unit_cost_source IS NOT NULL)
  );

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_pot_unit_cost_non_negative;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_pot_unit_cost_non_negative
  CHECK (pot_unit_cost IS NULL OR pot_unit_cost >= 0);

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_pot_unit_cost_source_check;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_pot_unit_cost_source_check
  CHECK (
    pot_unit_cost_source IS NULL
    OR pot_unit_cost_source = 'pots.supplier_price@segment'
  );

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_pot_unit_cost_pair_check;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_pot_unit_cost_pair_check
  CHECK (
    (pot_unit_cost IS NULL AND pot_unit_cost_source IS NULL)
    OR (pot_unit_cost IS NOT NULL AND pot_unit_cost_source IS NOT NULL)
  );

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_pot_unit_cost_requires_pot;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_pot_unit_cost_requires_pot
  CHECK (pot_id IS NOT NULL OR pot_unit_cost IS NULL);

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_total_supplier_unit_cost_non_negative;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_total_supplier_unit_cost_non_negative
  CHECK (total_supplier_unit_cost IS NULL OR total_supplier_unit_cost >= 0);

ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_total_supplier_unit_cost_consistent;
ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_total_supplier_unit_cost_consistent
  CHECK (
    total_supplier_unit_cost IS NULL
    OR (
      pot_id IS NULL
      AND plant_unit_cost IS NOT NULL
      AND total_supplier_unit_cost = round(plant_unit_cost, 2)
    )
    OR (
      pot_id IS NOT NULL
      AND plant_unit_cost IS NOT NULL
      AND pot_unit_cost IS NOT NULL
      AND total_supplier_unit_cost = round(plant_unit_cost + pot_unit_cost, 2)
    )
  );

-- Backfill 1: currently open cycles reflect live POS + catalog placement identity.
-- placement_kind stays NULL for pre-060 cycles (cannot prove initial vs restock).
UPDATE placement_cycles c
SET
  partner_id = COALESCE(c.partner_id, NULLIF(btrim(pr.id), '')),
  partner_name = COALESCE(c.partner_name, NULLIF(btrim(pr.name), '')),
  partner_location_id = COALESCE(c.partner_location_id, NULLIF(btrim(p.partner_location_id), '')),
  partner_location_name = COALESCE(c.partner_location_name, NULLIF(btrim(ploc.name), '')),
  plant_id = COALESCE(c.plant_id, NULLIF(btrim(pv.plant_id), '')),
  plant_name = COALESCE(c.plant_name, NULLIF(btrim(pl.name), '')),
  size_label = COALESCE(c.size_label, NULLIF(btrim(pv.size_label), ''))
FROM pos_spots p
LEFT JOIN partner_locations ploc ON ploc.id = p.partner_location_id
LEFT JOIN partners pr ON pr.id = ploc.partner_id,
plant_variants pv
LEFT JOIN plants pl ON pl.id = pv.plant_id
WHERE c.pos_spot_id = p.id
  AND pv.id = c.plant_variant_id
  AND c.ended_at IS NULL;

-- Backfill 2: closed sold cycles can safely recover partner/location/plant snapshots
-- from the immutable linked order row (never from mutable live POS/catalog labels).
UPDATE placement_cycles c
SET
  partner_id = COALESCE(c.partner_id, NULLIF(btrim(o.partner_id), '')),
  partner_location_id = COALESCE(
    c.partner_location_id,
    NULLIF(btrim(o.partner_location_id), ''),
    NULLIF(btrim(o.snapshot->>'partnerLocationId'), '')
  ),
  partner_location_name = COALESCE(
    c.partner_location_name,
    NULLIF(btrim(o.partner_location_name), ''),
    NULLIF(btrim(o.snapshot->>'partnerLocationName'), '')
  ),
  plant_id = COALESCE(
    c.plant_id,
    NULLIF(btrim(o.product_id), ''),
    NULLIF(btrim(pv.plant_id), '')
  ),
  plant_name = COALESCE(
    c.plant_name,
    NULLIF(btrim(o.snapshot->>'plantName'), ''),
    NULLIF(btrim(o.product_name), '')
  ),
  size_label = COALESCE(
    c.size_label,
    NULLIF(btrim(o.snapshot->>'plantSizeLabel'), '')
  )
FROM orders o, plant_variants pv
WHERE c.order_id = o.order_id
  AND pv.id = c.plant_variant_id
  AND c.ended_at IS NOT NULL
  AND c.end_reason = 'sold';

-- Backfill 3: remaining closed cycles only recover structural plant_id from plant_variant_id.
UPDATE placement_cycles c
SET plant_id = COALESCE(c.plant_id, NULLIF(btrim(pv.plant_id), ''))
FROM plant_variants pv
WHERE c.plant_variant_id = pv.id
  AND c.plant_id IS NULL;

-- Backfill 4: open segments on open cycles capture current pot_name when pot_id is set.
-- Historical supplier costs stay NULL for all pre-060 segments.
UPDATE placement_segments s
SET pot_name = COALESCE(s.pot_name, NULLIF(btrim(pot.name), ''))
FROM placement_cycles c, pots pot
WHERE s.placement_cycle_id = c.id
  AND pot.id = s.pot_id
  AND c.ended_at IS NULL
  AND s.ended_at IS NULL
  AND s.pot_id IS NOT NULL
  AND s.pot_name IS NULL;

COMMIT;
