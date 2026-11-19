-- Release Partner plant POS rows still held for payment.
-- Data only: no schema change. Does not cancel payment attempts, modify
-- Cardcom or payment evidence, touch catalog stock holds, flower spots,
-- or sold/inactive spots.

BEGIN;

UPDATE pos_spots AS p
SET
  status = 'available',
  payment_hold_started_at = NULL,
  payment_hold_attempt_id = NULL
WHERE p.status = 'held_for_payment'
  AND NOT EXISTS (
    SELECT 1
    FROM offers AS o
    INNER JOIN plants AS pl ON pl.id = o.product_id
    WHERE o.id = p.current_offer_id
      AND pl.inventory_type = 'flowers'
  );

COMMIT;
