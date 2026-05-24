-- Extend allowed activity event types (events.type CHECK)

BEGIN;

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_type_check;

ALTER TABLE events
  ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'order_created',
    'order_cancelled',
    'manual_status_update',
    'plant_placed',
    'plant_sold',
    'plant_removed',
    'plant_replaced',
    'qr_scanned',
    'plant_status_changed',
    'location_visit'
  ));

COMMIT;
