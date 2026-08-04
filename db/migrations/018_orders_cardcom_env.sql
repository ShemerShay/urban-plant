-- Remember which Cardcom credential set created the LowProfile session.
-- Required so webhook GetLpResult uses the same TerminalNumber + ApiName
-- (test terminal 1000 vs production 194476). Not inferred from NODE_ENV.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cardcom_env text;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_cardcom_env_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_cardcom_env_check
    CHECK (cardcom_env IS NULL OR cardcom_env IN ('test', 'production'));
