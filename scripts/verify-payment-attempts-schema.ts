/**
 * Phase 2 verification: payment_attempts schema + nullable POS hold owner.
 * Does not exercise checkout / Cardcom / expiry behavior.
 *
 * Run: npx tsx scripts/verify-payment-attempts-schema.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  isPaymentAttemptStatus,
  parsePaymentAttemptStatus,
} from "../lib/paymentAttemptTypes";
import { isOrderStatus } from "../lib/status";
import { isPosSpotStatus } from "../lib/posSpotTypes";

function assertPureTypes(): void {
  for (const status of [
    "created",
    "awaiting_payment",
    "finalized",
    "expired",
    "failed",
    "cancelled",
    "needs_reconciliation",
  ] as const) {
    assert.equal(isPaymentAttemptStatus(status), true);
    assert.equal(parsePaymentAttemptStatus(status), status);
  }
  assert.equal(isPaymentAttemptStatus("pending_payment"), false);
  assert.equal(isPaymentAttemptStatus("sold"), false);
  assert.equal(isPaymentAttemptStatus("held_for_payment"), false);
  assert.equal(parsePaymentAttemptStatus("not_a_status"), null);

  // Order / POS status domains unchanged
  assert.equal(isOrderStatus("pending_payment"), true);
  assert.equal(isOrderStatus("sold"), true);
  assert.equal(isOrderStatus("created"), false);
  assert.equal(isPosSpotStatus("held_for_payment"), true);
  assert.equal(isPosSpotStatus("awaiting_payment"), false);

  console.log("verify-payment-attempts-schema: pure types ok");
}

async function assertSchemaAndConstraints(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  try {
    await loadEnvLocal();
  } catch {
    console.log("verify-payment-attempts-schema: skip DB (no DATABASE_URL)");
    return;
  }

  const { sql } = await import("../lib/db");
  const {
    insertPaymentAttempt,
    getPaymentAttemptById,
    deletePaymentAttemptById,
  } = await import("../lib/paymentAttemptStorage");
  const { getPosSpotById, readPosSpots } = await import("../lib/posSpotStorage");

  // 1–3: table, columns, FKs/indexes/CHECKs
  const tables = await sql`
    SELECT 1 AS ok
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payment_attempts'
  `;
  assert.equal((tables as { ok: number }[]).length, 1);

  const expectedColumns = [
    "id",
    "status",
    "pos_spot_id",
    "offer_id",
    "product_id",
    "product_name",
    "full_name",
    "customer_email",
    "phone",
    "address",
    "apartment_or_notes",
    "fulfillment_method",
    "amount",
    "snapshot",
    "checkout_session_id",
    "cardcom_env",
    "payment_resume_token",
    "payment_retry_lock_at",
    "expires_at",
    "failure_reason",
    "finalized_order_id",
    "cardcom_transaction_id",
    "created_at",
    "updated_at",
  ];
  const cols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_attempts'
  `;
  const colNames = new Set(
    (cols as { column_name: string }[]).map((r) => r.column_name),
  );
  for (const name of expectedColumns) {
    assert.equal(colNames.has(name), true, `missing column ${name}`);
  }
  assert.equal(colNames.has("partner_location_id"), false);
  assert.equal(colNames.has("currency"), false);

  const ownerCol = await sql`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pos_spots'
      AND column_name = 'payment_hold_attempt_id'
  `;
  assert.equal((ownerCol as { is_nullable: string }[]).length, 1);
  assert.equal((ownerCol as { is_nullable: string }[])[0].is_nullable, "YES");

  const checks = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'payment_attempts'::regclass
      AND contype = 'c'
  `;
  const checkNames = new Set(
    (checks as { conname: string }[]).map((r) => r.conname),
  );
  assert.equal(checkNames.has("payment_attempts_status_check"), true);
  assert.equal(checkNames.has("payment_attempts_fulfillment_method_check"), true);
  assert.equal(checkNames.has("payment_attempts_cardcom_env_check"), true);

  const fks = await sql`
    SELECT conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND (
        conrelid = 'payment_attempts'::regclass
        OR conname = 'pos_spots_payment_hold_attempt_id_fkey'
      )
  `;
  const fkNames = new Set((fks as { conname: string }[]).map((r) => r.conname));
  assert.equal(fkNames.has("payment_attempts_pos_spot_id_fkey"), true);
  assert.equal(fkNames.has("pos_spots_payment_hold_attempt_id_fkey"), true);

  const indexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'payment_attempts'
  `;
  const indexNames = new Set(
    (indexes as { indexname: string }[]).map((r) => r.indexname),
  );
  assert.equal(indexNames.has("payment_attempts_checkout_session_id_unique"), true);
  assert.equal(indexNames.has("payment_attempts_payment_resume_token_unique"), true);
  assert.equal(indexNames.has("payment_attempts_finalized_order_id_unique"), true);
  assert.equal(indexNames.has("payment_attempts_status_expires_at_idx"), true);
  assert.equal(indexNames.has("payment_attempts_pos_spot_id_status_idx"), true);

  // Phase 1 timestamp CHECK still present; no held=>owner CHECK
  const posChecks = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'pos_spots'::regclass AND contype = 'c'
  `;
  const posCheckRows = posChecks as { conname: string; def: string }[];
  assert.ok(
    posCheckRows.some(
      (r) => r.conname === "pos_spots_held_for_payment_requires_hold_started_at",
    ),
  );
  assert.equal(
    posCheckRows.some((r) =>
      r.def.toLowerCase().includes("payment_hold_attempt_id"),
    ),
    false,
  );

  const spots = await readPosSpots();
  assert.ok(spots.length > 0, "need at least one POS spot for FK tests");
  const posSpotId = spots[0].id;

  const now = new Date().toISOString();
  const attemptId = randomUUID();
  const resumeToken = `resume-${randomUUID()}`;
  const sessionId = `lp-phase2-${randomUUID()}`;

  await insertPaymentAttempt({
    id: attemptId,
    status: "created",
    posSpotId,
    productId: "phase2-verify-product",
    productName: "Phase 2 Verify Product",
    fullName: "Phase 2 Verify",
    customerEmail: "phase2-verify@example.com",
    phone: "0500000000",
    address: "",
    apartmentOrNotes: "",
    fulfillmentMethod: "delivery",
    amount: 1,
    paymentResumeToken: resumeToken,
    checkoutSessionId: sessionId,
    createdAt: now,
    updatedAt: now,
  });

  const loaded = await getPaymentAttemptById(attemptId);
  assert.ok(loaded);
  assert.equal(loaded!.status, "created");
  assert.equal(loaded!.checkoutSessionId, sessionId);
  assert.equal(loaded!.paymentResumeToken, resumeToken);
  assert.equal(loaded!.amount, 1);

  // 4: duplicate non-null checkout_session_id rejected
  let dupSessionRejected = false;
  try {
    await insertPaymentAttempt({
      id: randomUUID(),
      status: "created",
      posSpotId,
      productId: "phase2-verify-product",
      productName: "Phase 2 Verify Product",
      fullName: "Phase 2 Verify",
      customerEmail: "phase2-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      amount: 1,
      paymentResumeToken: `resume-${randomUUID()}`,
      checkoutSessionId: sessionId,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    dupSessionRejected = true;
  }
  assert.equal(dupSessionRejected, true);

  // 5: duplicate payment_resume_token rejected
  let dupResumeRejected = false;
  try {
    await insertPaymentAttempt({
      id: randomUUID(),
      status: "created",
      posSpotId,
      productId: "phase2-verify-product",
      productName: "Phase 2 Verify Product",
      fullName: "Phase 2 Verify",
      customerEmail: "phase2-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      amount: 1,
      paymentResumeToken: resumeToken,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    dupResumeRejected = true;
  }
  assert.equal(dupResumeRejected, true);

  // 6: duplicate non-null finalized_order_id rejected
  const orderId = randomUUID();
  await sql`
    INSERT INTO orders (
      order_id, product_id, product_name, price, full_name, phone,
      address, apartment_or_notes, fulfillment_method, order_status, created_at
    )
    VALUES (
      ${orderId}::uuid, 'phase2-verify-product', 'Phase 2 Verify Product', 1,
      'Phase 2 Verify', '0500000000', '', '', 'delivery', 'cancelled', ${now}::timestamptz
    )
  `;
  await sql`
    UPDATE payment_attempts
    SET finalized_order_id = ${orderId}::uuid, updated_at = ${now}::timestamptz
    WHERE id = ${attemptId}::uuid
  `;

  const attemptIdB = randomUUID();
  await insertPaymentAttempt({
    id: attemptIdB,
    status: "created",
    posSpotId,
    productId: "phase2-verify-product",
    productName: "Phase 2 Verify Product",
    fullName: "Phase 2 Verify",
    customerEmail: "phase2-verify@example.com",
    phone: "0500000000",
    address: "",
    apartmentOrNotes: "",
    fulfillmentMethod: "delivery",
    amount: 1,
    paymentResumeToken: `resume-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  });

  let dupFinalizedRejected = false;
  try {
    await sql`
      UPDATE payment_attempts
      SET finalized_order_id = ${orderId}::uuid
      WHERE id = ${attemptIdB}::uuid
    `;
  } catch {
    dupFinalizedRejected = true;
  }
  assert.equal(dupFinalizedRejected, true);

  // 7: nullable payment_hold_attempt_id works
  const beforeOwner = await getPosSpotById(posSpotId);
  assert.equal(beforeOwner?.paymentHoldAttemptId, undefined);

  await sql`
    UPDATE pos_spots
    SET payment_hold_attempt_id = ${attemptId}::uuid
    WHERE id = ${posSpotId}::uuid
  `;
  const withOwner = await getPosSpotById(posSpotId);
  assert.equal(withOwner?.paymentHoldAttemptId, attemptId);

  await sql`
    UPDATE pos_spots
    SET payment_hold_attempt_id = NULL
    WHERE id = ${posSpotId}::uuid
  `;
  const clearedOwner = await getPosSpotById(posSpotId);
  assert.equal(clearedOwner?.paymentHoldAttemptId, undefined);

  // 8: invalid owner FK rejected
  let invalidOwnerRejected = false;
  try {
    await sql`
      UPDATE pos_spots
      SET payment_hold_attempt_id = ${randomUUID()}::uuid
      WHERE id = ${posSpotId}::uuid
    `;
  } catch {
    invalidOwnerRejected = true;
  }
  assert.equal(invalidOwnerRejected, true);

  // Invalid attempt status rejected
  let invalidStatusRejected = false;
  try {
    await sql`
      UPDATE payment_attempts
      SET status = 'pending_payment'
      WHERE id = ${attemptId}::uuid
    `;
  } catch {
    invalidStatusRejected = true;
  }
  assert.equal(invalidStatusRejected, true);

  // Cleanup
  await sql`
    UPDATE pos_spots
    SET payment_hold_attempt_id = NULL
    WHERE id = ${posSpotId}::uuid
  `;
  await deletePaymentAttemptById(attemptIdB);
  await deletePaymentAttemptById(attemptId);
  await sql`DELETE FROM orders WHERE order_id = ${orderId}::uuid`;

  console.log("verify-payment-attempts-schema: DB constraints ok");
}

async function main(): Promise<void> {
  assertPureTypes();
  await assertSchemaAndConstraints();
  console.log("verify-payment-attempts-schema: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
