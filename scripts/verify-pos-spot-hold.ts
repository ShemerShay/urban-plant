/**
 * Offline (+ optional DB) checks for POS purchase gates and leftover admin holds.
 *
 * Always runs pure gate checks (no network, no Cardcom).
 * If DATABASE_URL is set, exercises admin hold status and migration 053
 * on one spot and restores its prior status.
 *
 * Run: npx tsx scripts/verify-pos-spot-hold.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  isPosSpotPurchasable,
  posAllowsVerifiedPaymentFinalize,
} from "../lib/posSpotHold";
import type { PosSpotStatus } from "../lib/posSpotTypes";
import { posStatusAfterSuccessfulPayment } from "../lib/inventoryType";

function assertGates(): void {
  const statuses: PosSpotStatus[] = [
    "available",
    "held_for_payment",
    "sold",
    "inactive",
  ];

  assert.equal(isPosSpotPurchasable("available"), true);
  for (const status of statuses.filter((s) => s !== "available")) {
    assert.equal(isPosSpotPurchasable(status), false, `${status} must not be purchasable`);
  }

  // Resume holder may continue while an admin or leftover hold is set.
  assert.equal(isPosSpotPurchasable("held_for_payment", { resumeHolder: true }), true);
  assert.equal(isPosSpotPurchasable("sold"), false);
  assert.equal(posStatusAfterSuccessfulPayment("plants"), "sold");
  assert.equal(posStatusAfterSuccessfulPayment("flowers"), null);
  assert.equal(
    posAllowsVerifiedPaymentFinalize("plants", { status: "held_for_payment", paymentHoldAttemptId: "a1" }, "a1"),
    false,
  );
  assert.equal(
    posAllowsVerifiedPaymentFinalize("plants", { status: "available" }, "a1"),
    true,
  );
  assert.equal(
    posAllowsVerifiedPaymentFinalize("flowers", { status: "available" }, "a1"),
    true,
  );
  assert.equal(
    posAllowsVerifiedPaymentFinalize("flowers", { status: "held_for_payment", paymentHoldAttemptId: "a1" }, "a1"),
    false,
  );

  const root = process.cwd();
  const landing = readFileSync(join(root, "components/plant/PosPlantLanding.tsx"), "utf8");
  const checkout = readFileSync(join(root, "components/checkout/CheckoutForm.tsx"), "utf8");
  const messages = readFileSync(join(root, "lib/messages.ts"), "utf8");
  assert.doesNotMatch(landing, /plant\.held\./);
  assert.doesNotMatch(checkout, /plant\.held\./);
  assert.doesNotMatch(messages, /plant\.held\.product/);
  assert.doesNotMatch(messages, /plant\.held\.checkout/);
  assert.doesNotMatch(
    messages,
    /This plant is currently being purchased by another customer/,
  );
  assert.match(messages, /"plant\.cta\.held": "Purchase in progress"/);

  console.log("verify-pos-spot-hold: pure gates ok");
}

async function assertDbMutations(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  try {
    await loadEnvLocal();
  } catch {
    console.log("verify-pos-spot-hold: skip DB checks (no .env.local / DATABASE_URL)");
    return;
  }

  const {
    setPosSpotStatus,
    updatePosSpot,
    readPosSpots,
    getPosSpotById,
  } = await import("../lib/posSpotStorage");
  const {
    deletePaymentAttemptById,
    insertPaymentAttempt,
    finalizeVerifiedPaymentAttemptAtomic,
  } = await import("../lib/paymentAttemptStorage");
  const { createPlant, deletePlant, getPlantByIdAsync } = await import(
    "../lib/plantStorage"
  );

  const spots = await readPosSpots();
  const spot = spots[0];
  if (!spot) {
    console.log("verify-pos-spot-hold: skip DB checks (no POS spots)");
    return;
  }

  const before = spot.status;
  const attemptIds: string[] = [];
  const orderIds: string[] = [];

  async function insertAttempt(): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await insertPaymentAttempt({
      id,
      status: "created",
      posSpotId: spot!.id,
      productId: "verify-hold-product",
      productName: "Verify Hold Product",
      fullName: "Hold Verify",
      customerEmail: "hold-verify@example.com",
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      amount: 1,
      paymentResumeToken: `resume-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    attemptIds.push(id);
    return id;
  }

  try {
    await setPosSpotStatus(spot.id, "available");

    // Admin/updatePosSpot path must not create held_for_payment without timestamp.
    await setPosSpotStatus(spot.id, "available");
    const viaUpdate = await updatePosSpot(spot.id, {
      partnerLocationId: spot.partnerLocationId,
      posNumber: spot.posNumber ?? "",
      posName: spot.posName,
      currentOfferId: spot.currentOfferId,
      updateStatus: true,
      status: "held_for_payment",
    });
    assert.ok(viaUpdate);
    assert.equal(viaUpdate!.status, "held_for_payment");
    assert.ok(
      viaUpdate!.paymentHoldStartedAt,
      "updatePosSpot(held_for_payment) must set payment_hold_started_at",
    );
    const holdStarted = viaUpdate!.paymentHoldStartedAt;

    // Saving again as held must preserve the original hold start (not reset TTL).
    await new Promise((r) => setTimeout(r, 20));
    const again = await updatePosSpot(spot.id, {
      partnerLocationId: spot.partnerLocationId,
      posNumber: spot.posNumber ?? "",
      posName: spot.posName,
      currentOfferId: spot.currentOfferId,
      updateStatus: true,
      status: "held_for_payment",
    });
    assert.equal(again?.paymentHoldStartedAt, holdStarted);

    // Legacy null-owner held_for_payment may still be cleared by Admin.
    const cleared = await updatePosSpot(spot.id, {
      partnerLocationId: spot.partnerLocationId,
      posNumber: spot.posNumber ?? "",
      posName: spot.posName,
      currentOfferId: spot.currentOfferId,
      updateStatus: true,
      status: "available",
    });
    assert.equal(cleared?.status, "available");
    assert.equal(cleared?.paymentHoldStartedAt, undefined);

    const reloaded = await getPosSpotById(spot.id);
    assert.equal(reloaded?.status, "available");
    assert.equal(reloaded?.paymentHoldStartedAt, undefined);

    // Leftover attempt-owned hold: Admin may deliberately override it.
    const attemptAdmin = await insertAttempt();
    const { sql: holdSql } = await import("../lib/db");
    await holdSql`
      UPDATE pos_spots
      SET
        status = 'held_for_payment',
        payment_hold_started_at = now(),
        payment_hold_attempt_id = ${attemptAdmin}::uuid
      WHERE id = ${spot.id}::uuid
    `;
    assert.equal(
      (await getPosSpotById(spot.id))?.paymentHoldAttemptId,
      attemptAdmin,
    );

    // Non-status Admin edits remain allowed while owned.
    const nonStatusEdit = await updatePosSpot(spot.id, {
      partnerLocationId: spot.partnerLocationId,
      posNumber: spot.posNumber ?? "",
      posName: spot.posName,
      currentOfferId: spot.currentOfferId,
      updateStatus: false,
    });
    assert.ok(nonStatusEdit);
    assert.equal(nonStatusEdit!.status, "held_for_payment");
    assert.equal(nonStatusEdit!.paymentHoldAttemptId, attemptAdmin);

    // Admin override: leave held_for_payment → available, clears timestamp + owner.
    const adminOverride = await updatePosSpot(spot.id, {
      partnerLocationId: spot.partnerLocationId,
      posNumber: spot.posNumber ?? "",
      posName: spot.posName,
      currentOfferId: spot.currentOfferId,
      updateStatus: true,
      status: "available",
    });
    assert.equal(adminOverride?.status, "available");
    assert.equal(adminOverride?.paymentHoldAttemptId, undefined);
    assert.equal(adminOverride?.paymentHoldStartedAt, undefined);

    // Admin may enter held_for_payment with a fresh timestamp (null owner).
    const adminHold = await setPosSpotStatus(spot.id, "held_for_payment");
    assert.equal(adminHold?.status, "held_for_payment");
    assert.ok(adminHold?.paymentHoldStartedAt);
    assert.equal(adminHold?.paymentHoldAttemptId, undefined);

    const adminClear = await setPosSpotStatus(spot.id, "available");
    assert.equal(adminClear?.status, "available");
    assert.equal(adminClear?.paymentHoldStartedAt, undefined);

    const sample = await getPlantByIdAsync("monstera");
    assert.ok(sample, "need a catalog row to clone a flower inventory type");
    const flowerId = randomUUID();
    await createPlant({
      ...sample,
      id: flowerId,
      name: "Verify Flower Hold",
      inventoryType: "flowers",
      catalogPublished: false,
      createdAt: new Date().toISOString(),
    });
    try {
      await setPosSpotStatus(spot.id, "available");
      async function insertFlowerAttempt(checkoutSessionId: string): Promise<string> {
        const id = randomUUID();
        const now = new Date().toISOString();
        await insertPaymentAttempt({
          id,
          status: "awaiting_payment",
          posSpotId: spot.id,
          productId: flowerId,
          productName: "Verify Flower Hold",
          fullName: "Hold Verify",
          customerEmail: "hold-verify@example.com",
          phone: "0500000000",
          address: "",
          apartmentOrNotes: "",
          fulfillmentMethod: "pickup",
          amount: 1,
          checkoutSessionId,
          paymentResumeToken: `resume-${randomUUID()}`,
          createdAt: now,
          updatedAt: now,
        });
        attemptIds.push(id);
        return id;
      }

      const sessionA = `cs-flower-a-${randomUUID()}`;
      const sessionB = `cs-flower-b-${randomUUID()}`;
      const flowerAttemptA = await insertFlowerAttempt(sessionA);
      const flowerAttemptB = await insertFlowerAttempt(sessionB);
      assert.equal((await getPosSpotById(spot.id))?.status, "available");

      const flowerFinalA = await finalizeVerifiedPaymentAttemptAtomic({
        attemptId: flowerAttemptA,
        checkoutSessionId: sessionA,
        posSpotId: spot.id,
        fulfillmentMethod: "pickup",
      });
      const flowerFinalB = await finalizeVerifiedPaymentAttemptAtomic({
        attemptId: flowerAttemptB,
        checkoutSessionId: sessionB,
        posSpotId: spot.id,
        fulfillmentMethod: "pickup",
      });
      assert.equal(flowerFinalA.ok, true);
      assert.equal(flowerFinalB.ok, true);
      if (flowerFinalA.ok) {
        orderIds.push(flowerFinalA.order.orderId);
        assert.equal(flowerFinalA.posStatus, "available");
      }
      if (flowerFinalB.ok) {
        orderIds.push(flowerFinalB.order.orderId);
        assert.equal(flowerFinalB.posStatus, "available");
      }
      assert.notEqual(
        flowerFinalA.ok && flowerFinalA.order.orderId,
        flowerFinalB.ok && flowerFinalB.order.orderId,
      );
      assert.equal((await getPosSpotById(spot.id))?.status, "available");

      const flowerDup = await finalizeVerifiedPaymentAttemptAtomic({
        attemptId: flowerAttemptA,
        checkoutSessionId: sessionA,
        posSpotId: spot.id,
        fulfillmentMethod: "pickup",
      });
      assert.equal(flowerDup.ok, false);

      const { sql } = await import("../lib/db");
      const uniqueOnPos = await sql`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'orders'::regclass
          AND contype IN ('u', 'p')
          AND pg_get_constraintdef(oid) ILIKE '%pos_spot_id%'
      `;
      assert.equal(
        (uniqueOnPos as { conname: string }[]).length,
        0,
        "orders.pos_spot_id must allow multiple completed flower orders",
      );
    } finally {
      await deletePlant(flowerId);
    }

    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const migration = readFileSync(
      join(process.cwd(), "db/migrations/053_release_partner_plant_pos_holds.sql"),
      "utf8",
    );
    assert.match(migration, /SET\s+status = 'available'/);
    assert.match(migration, /payment_hold_started_at = NULL/);
    assert.match(migration, /payment_hold_attempt_id = NULL/);
    assert.match(migration, /p\.status = 'held_for_payment'/);
    assert.match(migration, /pl\.inventory_type = 'flowers'/);
    assert.doesNotMatch(migration, /catalog_stock_holds/);
    assert.doesNotMatch(migration, /payment_attempts/);
    assert.doesNotMatch(migration, /DELETE/i);

    const { sql } = await import("../lib/db");
    const dbHost = new URL(process.env.DATABASE_URL ?? "http://invalid").hostname;
    if (dbHost.includes("twilight-truth")) {
      throw new Error("Refusing to exercise migration 053 against production");
    }

    const evidenceBefore = await sql`
      SELECT
        count(*)::int AS attempts,
        count(cardcom_transaction_id)::int AS evidenced
      FROM payment_attempts
    `;
    const catalogHoldsBefore = await sql`
      SELECT count(*)::int AS holds FROM catalog_stock_holds
    `;
    await sql`
      UPDATE pos_spots
      SET
        status = 'held_for_payment',
        payment_hold_started_at = now(),
        payment_hold_attempt_id = NULL
      WHERE id = ${spot.id}::uuid
        AND status = 'available'
    `;
    assert.equal((await getPosSpotById(spot.id))?.status, "held_for_payment");
    const releasedOnce = await sql`
      UPDATE pos_spots AS p
      SET
        status = 'available',
        payment_hold_started_at = NULL,
        payment_hold_attempt_id = NULL
      WHERE p.id = ${spot.id}::uuid
        AND p.status = 'held_for_payment'
        AND NOT EXISTS (
          SELECT 1
          FROM offers AS o
          INNER JOIN plants AS pl ON pl.id = o.product_id
          WHERE o.id = p.current_offer_id
            AND pl.inventory_type = 'flowers'
        )
      RETURNING p.id
    `;
    assert.equal((releasedOnce as { id: string }[]).length, 1);
    assert.equal((await getPosSpotById(spot.id))?.status, "available");
    assert.equal((await getPosSpotById(spot.id))?.paymentHoldAttemptId, undefined);
    assert.equal((await getPosSpotById(spot.id))?.paymentHoldStartedAt, undefined);
    const releasedTwice = await sql`
      UPDATE pos_spots AS p
      SET
        status = 'available',
        payment_hold_started_at = NULL,
        payment_hold_attempt_id = NULL
      WHERE p.id = ${spot.id}::uuid
        AND p.status = 'held_for_payment'
        AND NOT EXISTS (
          SELECT 1
          FROM offers AS o
          INNER JOIN plants AS pl ON pl.id = o.product_id
          WHERE o.id = p.current_offer_id
            AND pl.inventory_type = 'flowers'
        )
      RETURNING p.id
    `;
    assert.equal((releasedTwice as { id: string }[]).length, 0);
    const evidenceAfter = await sql`
      SELECT
        count(*)::int AS attempts,
        count(cardcom_transaction_id)::int AS evidenced
      FROM payment_attempts
    `;
    const catalogHoldsAfter = await sql`
      SELECT count(*)::int AS holds FROM catalog_stock_holds
    `;
    assert.deepEqual(evidenceAfter, evidenceBefore);
    assert.deepEqual(catalogHoldsAfter, catalogHoldsBefore);

    const flowerSpots = await sql`
      SELECT p.id
      FROM pos_spots p
      INNER JOIN offers o ON o.id = p.current_offer_id
      INNER JOIN plants pl ON pl.id = o.product_id
      WHERE pl.inventory_type = 'flowers'
        AND p.status = 'available'
        AND p.id <> ${spot.id}::uuid
      LIMIT 1
    `;
    const flowerSpot = (flowerSpots as { id: string }[])[0];
    if (flowerSpot) {
      await sql`
        UPDATE pos_spots
        SET
          status = 'held_for_payment',
          payment_hold_started_at = now(),
          payment_hold_attempt_id = NULL
        WHERE id = ${flowerSpot.id}::uuid
          AND status = 'available'
      `;
      const flowerReleased = await sql`
        UPDATE pos_spots AS p
        SET
          status = 'available',
          payment_hold_started_at = NULL,
          payment_hold_attempt_id = NULL
        WHERE p.id = ${flowerSpot.id}::uuid
          AND p.status = 'held_for_payment'
          AND NOT EXISTS (
            SELECT 1
            FROM offers AS o
            INNER JOIN plants AS pl ON pl.id = o.product_id
            WHERE o.id = p.current_offer_id
              AND pl.inventory_type = 'flowers'
          )
        RETURNING p.id
      `;
      assert.equal((flowerReleased as { id: string }[]).length, 0);
      const flowerAfter = await sql`
        SELECT status FROM pos_spots WHERE id = ${flowerSpot.id}::uuid
      `;
      assert.equal((flowerAfter as { status: string }[])[0]?.status, "held_for_payment");
      await sql`
        UPDATE pos_spots
        SET
          status = 'available',
          payment_hold_started_at = NULL,
          payment_hold_attempt_id = NULL
        WHERE id = ${flowerSpot.id}::uuid
          AND status = 'held_for_payment'
          AND payment_hold_attempt_id IS NULL
      `;
    }

    if (dbHost.includes("snowy-credit")) {
      const updateMatch = migration.match(/UPDATE pos_spots AS p[\s\S]*?;/);
      if (!updateMatch) {
        throw new Error("migration 053 is missing its UPDATE statement");
      }
      const fullRelease = updateMatch[0].replace(/;\s*$/, "");
      const query = (
        sql as unknown as { query: (text: string) => Promise<unknown[]> }
      ).query.bind(sql);
      const plantHeld = async () => {
        const rows = await sql`
          SELECT count(*)::int AS n
          FROM pos_spots p
          WHERE p.status = 'held_for_payment'
            AND NOT EXISTS (
              SELECT 1
              FROM offers AS o
              INNER JOIN plants AS pl ON pl.id = o.product_id
              WHERE o.id = p.current_offer_id
                AND pl.inventory_type = 'flowers'
            )
        `;
        return (rows as { n: number }[])[0]?.n ?? -1;
      };
      await query(fullRelease);
      const afterFirst = await plantHeld();
      const evidenceMid = await sql`
        SELECT
          count(*)::int AS attempts,
          count(cardcom_transaction_id)::int AS evidenced
        FROM payment_attempts
      `;
      await query(fullRelease);
      const afterSecond = await plantHeld();
      const evidenceEnd = await sql`
        SELECT
          count(*)::int AS attempts,
          count(cardcom_transaction_id)::int AS evidenced
        FROM payment_attempts
      `;
      assert.equal(afterFirst, 0, "migration 053 releases plant holds");
      assert.equal(afterSecond, 0, "migration 053 is idempotent");
      assert.deepEqual(evidenceMid, evidenceBefore);
      assert.deepEqual(evidenceEnd, evidenceBefore);
    }

    console.log("verify-pos-spot-hold: DB atomic mutations ok");
  } finally {
    for (const id of [...new Set(attemptIds)]) {
      await deletePaymentAttemptById(id);
    }
    if (orderIds.length > 0) {
      const { sql } = await import("../lib/db");
      for (const id of [...new Set(orderIds)]) {
        await sql`DELETE FROM orders WHERE order_id = ${id}::uuid`;
      }
    }
    await setPosSpotStatus(spot.id, before);
  }
}

assertGates();

void assertDbMutations()
  .then(() => {
    console.log("verify-pos-spot-hold: done (no Cardcom calls)");
  })
  .catch((error) => {
    console.error("verify-pos-spot-hold: FAILED", error);
    process.exitCode = 1;
  });
