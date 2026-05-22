-- Finish events.pos_spot_id → uuid after 004 (legacy text refs that no longer match pos_spots.id).

-- Repoint via spot_name (legacy id was copied there during 004)
UPDATE events e
SET pos_spot_id = ps.id::text
FROM pos_spots ps
WHERE e.pos_spot_id IS NOT NULL
  AND e.pos_spot_id = ps.spot_name;

-- Clear orphaned soft references (deleted or unknown spots)
UPDATE events
SET pos_spot_id = NULL
WHERE pos_spot_id IS NOT NULL
  AND pos_spot_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE events
  ALTER COLUMN pos_spot_id TYPE uuid USING NULLIF(TRIM(pos_spot_id::text), '')::uuid;
