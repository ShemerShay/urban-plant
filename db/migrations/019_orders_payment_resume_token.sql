-- Unguessable resume token for the customer who started a pending Cardcom payment.
-- Included only in Cardcom Success/Failed redirect URLs; never returned from public status APIs.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_resume_token text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_resume_token_unique
  ON orders (payment_resume_token)
  WHERE payment_resume_token IS NOT NULL;
