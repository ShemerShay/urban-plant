-- Cardcom document + Urban Plant confirmation email tracking.
-- Safe for existing orders: new columns are nullable with no backfill required.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cardcom_transaction_id bigint;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cardcom_document_type text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cardcom_document_number bigint;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS purchase_email_status text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS purchase_email_sent_at timestamptz;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS purchase_email_last_error text;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_purchase_email_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_purchase_email_status_check
    CHECK (
      purchase_email_status IS NULL
      OR purchase_email_status IN ('pending', 'processing', 'sent', 'failed')
    );
