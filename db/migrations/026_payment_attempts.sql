-- Phase 2: payment_attempts schema + nullable POS hold owner.
-- Additive only. No checkout/Cardcom/expiry behavior change.
-- Do NOT enforce held_for_payment => payment_hold_attempt_id (cutover phase).

CREATE TABLE IF NOT EXISTS payment_attempts (
  id                      uuid PRIMARY KEY,
  status                  text NOT NULL,
  pos_spot_id             uuid NOT NULL REFERENCES pos_spots (id),
  offer_id                text REFERENCES offers (id),
  product_id              text NOT NULL,
  product_name            text NOT NULL,
  full_name               text NOT NULL,
  customer_email          text NOT NULL,
  phone                   text NOT NULL DEFAULT '',
  address                 text NOT NULL DEFAULT '',
  apartment_or_notes      text NOT NULL DEFAULT '',
  fulfillment_method      text NOT NULL,
  amount                  numeric(10, 2) NOT NULL,
  snapshot                jsonb,
  checkout_session_id     text,
  cardcom_env             text,
  payment_resume_token    text NOT NULL,
  payment_retry_lock_at   timestamptz,
  expires_at              timestamptz,
  failure_reason          text,
  finalized_order_id      uuid REFERENCES orders (order_id),
  cardcom_transaction_id  bigint,
  created_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL,

  CONSTRAINT payment_attempts_status_check
    CHECK (
      status IN (
        'created',
        'awaiting_payment',
        'finalized',
        'expired',
        'failed',
        'cancelled',
        'needs_reconciliation'
      )
    ),
  CONSTRAINT payment_attempts_fulfillment_method_check
    CHECK (fulfillment_method IN ('delivery', 'pickup')),
  CONSTRAINT payment_attempts_cardcom_env_check
    CHECK (cardcom_env IS NULL OR cardcom_env IN ('test', 'production'))
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_checkout_session_id_unique
  ON payment_attempts (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_payment_resume_token_unique
  ON payment_attempts (payment_resume_token);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_finalized_order_id_unique
  ON payment_attempts (finalized_order_id)
  WHERE finalized_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_attempts_status_expires_at_idx
  ON payment_attempts (status, expires_at);

CREATE INDEX IF NOT EXISTS payment_attempts_pos_spot_id_status_idx
  ON payment_attempts (pos_spot_id, status);

-- Nullable hold owner for future attempt-centric expiry. Existing rows stay valid.
ALTER TABLE pos_spots
  ADD COLUMN IF NOT EXISTS payment_hold_attempt_id uuid;

ALTER TABLE pos_spots
  DROP CONSTRAINT IF EXISTS pos_spots_payment_hold_attempt_id_fkey;

ALTER TABLE pos_spots
  ADD CONSTRAINT pos_spots_payment_hold_attempt_id_fkey
  FOREIGN KEY (payment_hold_attempt_id)
  REFERENCES payment_attempts (id)
  ON DELETE SET NULL;
