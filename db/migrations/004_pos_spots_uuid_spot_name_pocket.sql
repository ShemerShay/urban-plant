-- pos_spots: UUID primary key, spot_name, pocket fields
-- Preserves existing spot_slug values. Moves readable text id → spot_name before UUID swap.
-- Updates orders.pos_spot_id and events.pos_spot_id FK / soft references.
-- FK must be dropped before repointing orders (pos_spots.id is still text during update).

-- 1. New columns
ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS spot_name text;
ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS pocket text;
ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS pocket_other text;
ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS new_id uuid;

-- 2. Backfill spot_name from legacy readable id (do not touch spot_slug)
UPDATE pos_spots
SET spot_name = id
WHERE spot_name IS NULL OR TRIM(spot_name) = '';

-- 3. Assign UUIDs
UPDATE pos_spots
SET new_id = gen_random_uuid()
WHERE new_id IS NULL;

-- 4. Drop FK before repointing orders
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pos_spot_id_fkey;

-- 5. Repoint dependent rows
UPDATE orders o
SET pos_spot_id = ps.new_id::text
FROM pos_spots ps
WHERE o.pos_spot_id IS NOT NULL
  AND o.pos_spot_id = ps.id;

UPDATE events e
SET pos_spot_id = ps.new_id::text
FROM pos_spots ps
WHERE e.pos_spot_id IS NOT NULL
  AND e.pos_spot_id = ps.id;

-- Legacy event refs may still use old text ids — match via spot_name after id swap prep
UPDATE events e
SET pos_spot_id = ps.new_id::text
FROM pos_spots ps
WHERE e.pos_spot_id IS NOT NULL
  AND e.pos_spot_id = ps.spot_name
  AND ps.new_id IS NOT NULL;

-- 6. Swap pos_spots.id to UUID
ALTER TABLE pos_spots DROP CONSTRAINT IF EXISTS pos_spots_pkey;
ALTER TABLE pos_spots DROP COLUMN id;
ALTER TABLE pos_spots RENAME COLUMN new_id TO id;
ALTER TABLE pos_spots ALTER COLUMN id SET NOT NULL;
ALTER TABLE pos_spots ADD PRIMARY KEY (id);
ALTER TABLE pos_spots ALTER COLUMN spot_name SET NOT NULL;

-- 7. Convert referencing columns to uuid and restore FK
ALTER TABLE orders
  ALTER COLUMN pos_spot_id TYPE uuid USING NULLIF(TRIM(pos_spot_id), '')::uuid;

ALTER TABLE orders
  ADD CONSTRAINT orders_pos_spot_id_fkey
  FOREIGN KEY (pos_spot_id) REFERENCES pos_spots (id);

-- Clear orphaned event soft refs before uuid cast
UPDATE events
SET pos_spot_id = NULL
WHERE pos_spot_id IS NOT NULL
  AND pos_spot_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE events
  ALTER COLUMN pos_spot_id TYPE uuid USING NULLIF(TRIM(pos_spot_id::text), '')::uuid;