-- Allow temporary payment hold on POS inventory status.
-- held_for_payment: customer started external payment; not yet verified.

ALTER TABLE pos_spots
  DROP CONSTRAINT IF EXISTS pos_spots_status_check;

ALTER TABLE pos_spots
  ADD CONSTRAINT pos_spots_status_check
  CHECK (status IN ('available', 'sold', 'inactive', 'held_for_payment'));
