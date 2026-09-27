/**
 * Phase 1.2: partner commission tiers + monthly plant assignment.
 * Run: npx tsx scripts/verify-commission-tiers.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function main(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const { rateFromTierRows } = await import("../lib/orderCommission");
  assert.equal(rateFromTierRows([{ minUnits: 1, maxUnits: 5, commissionRate: 10 }, { minUnits: 6, maxUnits: 10, commissionRate: 12 }, { minUnits: 11, maxUnits: null, commissionRate: 14 }], 6), 12);
  assert.equal(rateFromTierRows([{ minUnits: 1, maxUnits: null, commissionRate: 0 }], 9), 0);
  console.log("verify-commission-tiers: lookup helper ok");

  const { sql } = await import("../lib/db");
  const { appendOrder, getOrderById, replaceOrder } = await import("../lib/ordersStorage");
  const { createPartner } = await import("../lib/partnerStorage");
  const {
    PartnerCommissionAgreementLockedError,
    readPartnerCommissionTiers,
    replacePartnerCommissionTiers,
  } = await import("../lib/partnerCommissionStorage");

  const partnerRows = await sql`
    SELECT p.id, COUNT(t.id)::int AS tier_count
    FROM partners p
    LEFT JOIN partner_commission_tiers t ON t.partner_id = p.id
    GROUP BY p.id
  `;
  assert.ok((partnerRows as { id: string; tier_count: number }[]).length > 0, "partners exist");
  for (const row of partnerRows as { id: string; tier_count: number }[]) {
    assert.ok(Number(row.tier_count) >= 1, `partner ${row.id} missing commission tier`);
  }

  const zeroTiers = await sql`
    SELECT partner_id, min_units, max_units, commission_rate
    FROM partner_commission_tiers
    WHERE max_units IS NULL AND commission_rate = 0 AND min_units = 1
  `;
  assert.ok((zeroTiers as unknown[]).length >= 1, "unbounded 0% tiers exist");

  const plantRates = await sql`
    SELECT o.commission_rate, COALESCE(p.inventory_type, 'plants') AS inventory_type
    FROM orders o
    LEFT JOIN plants p ON p.id = o.product_id
    WHERE o.channel = 'partner'
  `;
  for (const row of plantRates as { commission_rate: string | number | null; inventory_type: string }[]) {
    if (row.inventory_type === "flowers") {
      assert.equal(row.commission_rate, null, "flower orders must stay NULL");
    } else {
      assert.equal(Number(row.commission_rate), 0, "existing partner plant orders should be 0");
    }
  }
  console.log("verify-commission-tiers: seed and backfill ok");

  const plantRows = await sql`
    SELECT id, name FROM plants
    WHERE COALESCE(inventory_type, 'plants') = 'plants'
    LIMIT 1
  `;
  const flowerRows = await sql`
    SELECT id, name FROM plants
    WHERE inventory_type = 'flowers'
    LIMIT 1
  `;
  const plant = (plantRows as { id: string; name: string }[])[0];
  const flower = (flowerRows as { id: string; name: string }[])[0];
  assert.ok(plant, "need a plant product");
  assert.ok(flower, "need a flower product");

  const testPartner = await createPartner({
    id: `commission-verify-${randomUUID()}`,
    name: "Commission Verify Partner",
    image: null,
  });
  const createdIds: string[] = [];

  const baseOrder = {
    locationId: null,
    locationName: null,
    locationAddress: null,
    price: 10,
    fullName: "Commission Verify",
    phone: "0500000000",
    address: "",
    apartmentOrNotes: "",
    fulfillmentMethod: "delivery" as const,
    orderStatus: "sold" as const,
    source: "online" as const,
    channel: "partner" as const,
    partnerId: testPartner.id,
  };

  try {
    const defaultTiers = await readPartnerCommissionTiers(testPartner.id);
    assert.equal(defaultTiers.length, 1);
    assert.equal(defaultTiers[0]?.commissionRate, 0);
    assert.equal(defaultTiers[0]?.maxUnits, null);

    let replaceRolledBack = false;
    try {
      await sql.transaction([
        sql`
          DELETE FROM partner_commission_tiers
          WHERE partner_id = ${testPartner.id}
        `,
        sql`
          INSERT INTO partner_commission_tiers (
            id, partner_id, min_units, max_units, commission_rate
          )
          VALUES (${`bad-${testPartner.id}`}, ${testPartner.id}, 0, NULL, 0)
        `,
      ]);
    } catch {
      replaceRolledBack = true;
    }
    assert.equal(replaceRolledBack, true, "invalid replacement transaction must fail");
    const afterFailedReplace = await readPartnerCommissionTiers(testPartner.id);
    assert.equal(afterFailedReplace.length, 1);
    assert.equal(afterFailedReplace[0]?.commissionRate, 0);
    assert.equal(afterFailedReplace[0]?.maxUnits, null);
    console.log("verify-commission-tiers: failed replace rolls back ok");

    await replacePartnerCommissionTiers(testPartner.id, [
      { minUnits: 1, maxUnits: 5, commissionRate: 10 },
      { minUnits: 6, maxUnits: 10, commissionRate: 12 },
      { minUnits: 11, maxUnits: null, commissionRate: 14 },
    ]);

    for (let i = 0; i < 5; i += 1) {
      const orderId = randomUUID();
      createdIds.push(orderId);
      await appendOrder({
        ...baseOrder,
        orderId,
        plantId: plant.id,
        plantName: plant.name,
        createdAt: new Date().toISOString(),
      });
    }
    for (const orderId of createdIds) {
      const order = await getOrderById(orderId);
      assert.equal(order?.commissionRate, 10, "first five plants in month are 10%");
    }

    const sixthId = randomUUID();
    createdIds.push(sixthId);
    await appendOrder({
      ...baseOrder,
      orderId: sixthId,
      plantId: plant.id,
      plantName: plant.name,
      createdAt: new Date().toISOString(),
    });
    for (const orderId of createdIds) {
      const order = await getOrderById(orderId);
      assert.equal(order?.commissionRate, 12, "sixth plant recalculates the open month to 12%");
    }
    console.log("verify-commission-tiers: open-month recalc ok");

    const flowerId = randomUUID();
    createdIds.push(flowerId);
    await appendOrder({
      ...baseOrder,
      orderId: flowerId,
      plantId: flower.id,
      plantName: flower.name,
      createdAt: new Date().toISOString(),
    });
    const flowerOrder = await getOrderById(flowerId);
    assert.equal(flowerOrder?.commissionRate, null, "flowers stay NULL");
    for (const orderId of createdIds.slice(0, 6)) {
      const order = await getOrderById(orderId);
      assert.equal(order?.commissionRate, 12, "flowers do not change plant rates");
    }
    console.log("verify-commission-tiers: flowers excluded ok");

    const closedId = randomUUID();
    createdIds.push(closedId);
    const closedCreatedAt = new Date();
    closedCreatedAt.setUTCMonth(closedCreatedAt.getUTCMonth() - 2);
    await appendOrder({
      ...baseOrder,
      orderId: closedId,
      plantId: plant.id,
      plantName: plant.name,
      createdAt: closedCreatedAt.toISOString(),
    });
    const closedOrder = await getOrderById(closedId);
    assert.equal(closedOrder?.commissionRate, null, "closed-month insert is not assigned from live tiers");
    for (const orderId of createdIds.slice(0, 6)) {
      const order = await getOrderById(orderId);
      assert.equal(order?.commissionRate, 12, "closed-month insert does not rewrite the open month");
    }
    console.log("verify-commission-tiers: closed month frozen ok");

    let locked = false;
    try {
      await replacePartnerCommissionTiers(testPartner.id, [
        { minUnits: 1, maxUnits: null, commissionRate: 0 },
      ]);
    } catch (error) {
      locked = error instanceof PartnerCommissionAgreementLockedError;
    }
    assert.equal(locked, true, "tier replace is blocked while the open month has plant sales");
    for (const orderId of createdIds.slice(0, 6)) {
      const order = await getOrderById(orderId);
      assert.equal(order?.commissionRate, 12, "blocked tier edit does not rewrite orders");
    }
    console.log("verify-commission-tiers: month-boundary agreement lock ok");

    const before = await getOrderById(createdIds[0]!);
    assert.ok(before);
    const replaced = await replaceOrder({
      ...before,
      orderStatus: "delivered",
      deliveredAt: new Date().toISOString(),
    });
    assert.equal(replaced?.commissionRate, 12);
    const afterStatus = await getOrderById(createdIds[0]!);
    assert.equal(afterStatus?.commissionRate, 12);
    assert.equal(afterStatus?.orderStatus, "delivered");
    console.log("verify-commission-tiers: status update preserves commission ok");
  } finally {
    for (const orderId of createdIds) {
      await sql`DELETE FROM orders WHERE order_id = ${orderId}::uuid`;
    }
    await sql`DELETE FROM partner_commission_tiers WHERE partner_id = ${testPartner.id}`;
    await sql`DELETE FROM partners WHERE id = ${testPartner.id}`;
  }

  const seeded = await sql`
    SELECT p.id, t.min_units, t.max_units, t.commission_rate
    FROM partners p
    JOIN partner_commission_tiers t ON t.partner_id = p.id
    WHERE p.id NOT LIKE 'commission-verify-%'
    ORDER BY p.id, t.min_units
  `;
  for (const row of seeded as {
    id: string;
    min_units: number;
    max_units: number | null;
    commission_rate: string | number;
  }[]) {
    assert.equal(Number(row.min_units), 1);
    assert.equal(row.max_units, null);
    assert.equal(Number(row.commission_rate), 0, `seeded 0% tier changed for ${row.id}`);
  }
  console.log("verify-commission-tiers: seeded 0% tiers unchanged");

  console.log("verify-commission-tiers: all ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
