-- Allow unpaid checkout rows on orders for Cardcom payment lifecycle.
-- pending_payment: checkout stored; payment not yet verified.
-- Unique non-null checkout_session_id for future Cardcom LowProfileId / webhook lookup.

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_order_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_order_status_check
  CHECK (
    order_status IN (
      'pending_payment',
      'sold',
      'picked_up',
      'delivered',
      'cancelled'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_session_id_unique
  ON orders (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;
