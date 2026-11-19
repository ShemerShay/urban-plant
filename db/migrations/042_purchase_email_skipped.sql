-- Allow purchase_email_status = 'skipped' (plant order without a customer email:
-- Cardcom document is created, customer email is intentionally not sent).
-- Additive: widens the existing CHECK from 020; no data changes.

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_purchase_email_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_purchase_email_status_check
    CHECK (
      purchase_email_status IS NULL
      OR purchase_email_status IN ('pending', 'processing', 'sent', 'failed', 'skipped')
    );
