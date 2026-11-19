/**
 * Finance MVP: sale-time Partner cost, ledger math, allocations, and Base44 CSV rules.
 * Run: npx tsx scripts/verify-finance.ts
 */

import type { FinanceFacts } from "../lib/finance/view";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function applyMigration(file: string): void {
  const result = spawnSync(process.execPath, ["scripts/apply-sql-file.mjs", file], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Migration failed: ${file}`);
  }
}

async function main(): Promise<void> {
  const prep = read("lib/startCardcomPaymentPrep.ts");
  const finalize = read("lib/paymentAttemptStorage.ts");
  const dashboard = read("components/admin/AdminFinanceDashboard.tsx");
  assert.match(prep, /partnerSupplierCostFromPlantPrice\(plant\.supplierPrice\)/);
  assert.match(finalize, /supplier_unit_cost/);
  assert.match(finalize, /supplierUnitCostSource/);
  assert.match(dashboard, /view\.openObligations > 0/);
  assert.match(dashboard, /FINANCE_ACTIVITY_FILTERS/);
  assert.match(dashboard, /row\.totalInvested/);
  assert.match(dashboard, /admin\.finance\.colTotalInvested/);
  assert.doesNotMatch(dashboard, /monthlyRevenue|monthly_revenue|setupCost|setup_cost/);
  const partnerPage = read("app/admin/partners/[partnerId]/page.tsx");
  assert.match(partnerPage, /loadPartnerFinanceSummary/);
  assert.doesNotMatch(partnerPage, /loadFinanceView\(/);
  assert.match(partnerPage, /data-partner-finance="summary"/);
  const financeStorage = read("lib/finance/storage.ts");
  assert.match(financeStorage, /loadFinanceFactsForPartner/);
  assert.match(financeStorage, /partner_id = \$\{trimmed\}/);
  assert.match(financeStorage, /buildFinanceView\(await loadFinanceFactsForPartner/);
  assert.match(financeStorage, /partnerFinanceSummary\(view\.partners/);
  assert.doesNotMatch(partnerPage, /monthlyRevenue|monthly_revenue|setupCost|setup_cost|payments/);
  assert.doesNotMatch(
    read("lib/finance/view.ts"),
    /monthlyRevenue|monthly_revenue|setupCost|setup_cost|partner_locations/,
  );
  assert.doesNotMatch(read("lib/finalizeCatalogPayment.ts"), /supplier_unit_cost/);

  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const { PLANT_UNIT_COST_SOURCE } = await import("../lib/catalogCheckoutSnapshot");
  const {
    PARTNER_SUPPLIER_UNIT_COST_SOURCE,
    partnerSupplierCostFromPlantPrice,
    parseStoredPartnerSupplierCost,
  } = await import("../lib/partnerSupplierCost");
  const { buildFinanceView, partnerFinanceSummary } = await import("../lib/finance/view");
  const {
    base44InvestmentTotalsMatch,
    parseBase44Csv,
  } = await import("../lib/finance/base44Csv");
  const { financeMonthKey } = await import("../lib/finance/period");
  const { jerusalemMonthKey } = await import("../lib/orderCommission");

  assert.equal(PARTNER_SUPPLIER_UNIT_COST_SOURCE, PLANT_UNIT_COST_SOURCE);
  assert.equal(financeMonthKey(new Date("2026-03-15T00:30:00.000Z")), jerusalemMonthKey(new Date("2026-03-15T00:30:00.000Z")));
  assert.deepEqual(partnerSupplierCostFromPlantPrice(0), {
    supplierUnitCost: 0,
    supplierUnitCostSource: "plants.supplier_price@sale",
  });
  assert.equal(partnerSupplierCostFromPlantPrice(null), null);
  assert.equal(partnerSupplierCostFromPlantPrice(-1), null);
  assert.deepEqual(
    parseStoredPartnerSupplierCost({
      supplierUnitCost: 12.5,
      supplierUnitCostSource: "plants.supplier_price@sale",
    }),
    { supplierUnitCost: 12.5, supplierUnitCostSource: "plants.supplier_price@sale" },
  );
  assert.deepEqual(parseStoredPartnerSupplierCost({ supplierPrice: 12.5 }), {});

  const view = buildFinanceView(
    {
      orders: [
        {
          id: "order-1",
          occurredOn: "2026-03-02",
          month: "2026-03",
          amount: 100,
          description: "Plant",
          partnerId: "partner-1",
          partnerName: "Partner",
        },
      ],
      entries: [
        {
          id: "expense-unpaid",
          kind: "expense",
          occurredOn: "2026-03-04",
          amount: 40,
          description: "Sign",
          category: "marketing_signage",
          partnerId: "partner-1",
          partnerName: "Partner",
          paymentStatus: "unpaid",
          imported: false,
        },
        {
          id: "expense-paid",
          kind: "expense",
          occurredOn: "2026-03-05",
          amount: 10,
          description: "Software",
          category: "software_systems",
          partnerId: null,
          partnerName: null,
          paymentStatus: "paid",
          imported: false,
        },
        {
          id: "purchase-1",
          kind: "inventory_purchase",
          occurredOn: "2026-03-01",
          amount: 80,
          description: "Pots",
          category: null,
          partnerId: null,
          partnerName: null,
          paymentStatus: "unpaid",
          imported: false,
        },
        {
          id: "settlement-1",
          kind: "historical_settlement",
          occurredOn: "2026-03-20",
          amount: 500,
          description: "Cardcom",
          category: null,
          partnerId: null,
          partnerName: null,
          paymentStatus: "paid",
          imported: true,
        },
      ],
      allocations: [
        {
          id: "alloc-1",
          purchaseId: "purchase-1",
          occurredOn: "2026-03-06",
          amount: 30,
          description: "To partner",
          partnerId: "partner-1",
          partnerName: "Partner",
          purchaseDescription: "Pots",
          imported: false,
        },
      ],
      unmatched: [
        {
          id: "attempt-1",
          occurredOn: "2026-03-07",
          month: "2026-03",
          amount: 70,
          channel: "catalog",
          reason: "late_cardcom_success",
          cardcomTransactionId: 99,
          productName: "Monstera",
          partnerId: null,
          partnerName: null,
        },
      ],
    },
    "2026-03",
    "all",
  );
  assert.equal(view.orderRevenue, 100);
  assert.equal(view.expenses, 50);
  assert.equal(view.openObligations, 120);
  assert.equal(view.operatingResult, 50);
  assert.equal(view.purchased, 80);
  assert.equal(view.allocated, 30);
  assert.equal(view.remaining, 50);
  assert.equal(view.purchases[0]?.remaining, 50);
  assert.equal(view.unmatchedAmount, 70);
  const partnerRow = view.partners[0];
  assert.equal(partnerRow?.orderRevenue, 100);
  assert.equal(partnerRow?.expenses, 40);
  assert.equal(partnerRow?.allocated, 30);
  assert.equal(partnerRow?.totalInvested, 70);
  assert.equal(partnerRow?.result, 60);
  assert.equal(
    partnerRow?.result,
    (partnerRow?.orderRevenue ?? 0) + (partnerRow?.otherIncome ?? 0) - (partnerRow?.expenses ?? 0),
  );
  assert.equal(partnerRow?.totalInvested, (partnerRow?.expenses ?? 0) + (partnerRow?.allocated ?? 0));
  const withOtherIncome = buildFinanceView(
    {
      orders: [
        {
          id: "order-1",
          occurredOn: "2026-03-02",
          month: "2026-03",
          amount: 100,
          description: "Plant",
          partnerId: "partner-1",
          partnerName: "Partner",
        },
      ],
      entries: [
        {
          id: "expense-unpaid",
          kind: "expense",
          occurredOn: "2026-03-04",
          amount: 40,
          description: "Sign",
          category: "marketing_signage",
          partnerId: "partner-1",
          partnerName: "Partner",
          paymentStatus: "unpaid",
          imported: false,
        },
        {
          id: "income-1",
          kind: "other_income",
          occurredOn: "2026-03-08",
          amount: 15,
          description: "Credit",
          category: null,
          partnerId: "partner-1",
          partnerName: "Partner",
          paymentStatus: "paid",
          imported: false,
        },
      ],
      allocations: [
        {
          id: "alloc-1",
          purchaseId: "purchase-1",
          occurredOn: "2026-03-06",
          amount: 30,
          description: "To partner",
          partnerId: "partner-1",
          partnerName: "Partner",
          purchaseDescription: "Pots",
          imported: false,
        },
      ],
      unmatched: [],
    },
    "all",
    "all",
  );
  const incomePartner = withOtherIncome.partners[0];
  assert.equal(incomePartner?.otherIncome, 15);
  assert.equal(incomePartner?.expenses, 40);
  assert.equal(incomePartner?.allocated, 30);
  assert.equal(incomePartner?.totalInvested, 70);
  assert.equal(incomePartner?.result, 75);
  assert.deepEqual(partnerFinanceSummary(view.partners, "missing-partner"), {
    orderRevenue: 0,
    otherIncome: 0,
    expenses: 0,
    allocated: 0,
    totalInvested: 0,
    result: 0,
  });
  assert.equal(view.activityRows.some((row) => row.source === "order"), true);
  assert.equal(view.activityRows.filter((row) => row.type === "order").length, 1);
  const expensesOnly = buildFinanceView(
    {
      orders: view.activityRows
        .filter(() => false)
        .map(() => {
          throw new Error("unused");
        }),
      entries: [
        {
          id: "expense-unpaid",
          kind: "expense",
          occurredOn: "2026-03-04",
          amount: 40,
          description: "Sign",
          category: "marketing_signage",
          partnerId: null,
          partnerName: null,
          paymentStatus: "unpaid",
          imported: false,
        },
      ],
      allocations: [],
      unmatched: [],
    },
    "all",
    "expense",
  );
  assert.equal(expensesOnly.activityRows.length, 1);
  assert.equal(expensesOnly.activityRows[0]?.type, "expense");
  assert.equal(
    buildFinanceView(
      {
        orders: [],
        entries: [
          {
            id: "paid",
            kind: "expense",
            occurredOn: "2026-01-01",
            amount: 5,
            description: "Paid",
            category: "other",
            partnerId: null,
            partnerName: null,
            paymentStatus: "paid",
            imported: false,
          },
        ],
        allocations: [],
        unmatched: [],
      },
      "all",
      "all",
    ).openObligations,
    0,
  );

  const obligationFacts = {
    orders: [
      {
        id: "order-1",
        occurredOn: "2026-03-02",
        month: "2026-03",
        amount: 100,
        description: "Plant",
        partnerId: null,
        partnerName: null,
      },
    ],
    allocations: [] as FinanceFacts["allocations"],
    unmatched: [] as FinanceFacts["unmatched"],
  };
  function obligationView(
    entries: FinanceFacts["entries"],
    extras?: Partial<Pick<FinanceFacts, "allocations" | "unmatched">>,
  ) {
    return buildFinanceView(
      {
        ...obligationFacts,
        entries,
        allocations: extras?.allocations ?? [],
        unmatched: extras?.unmatched ?? [],
      },
      "2026-03",
      "all",
    );
  }
  const obligationBase = obligationView([]);
  assert.equal(obligationBase.openObligations, 0);
  assert.equal(obligationBase.operatingResult, 100);
  const unpaidExpense = obligationView([
    {
      id: "expense-unpaid",
      kind: "expense",
      occurredOn: "2026-03-04",
      amount: 40,
      description: "Sign",
      category: "marketing_signage",
      partnerId: null,
      partnerName: null,
      paymentStatus: "unpaid",
      imported: false,
    },
  ]);
  assert.equal(unpaidExpense.openObligations, 40);
  assert.equal(unpaidExpense.operatingResult, 60);
  const paidExpense = obligationView([
    {
      id: "expense-paid",
      kind: "expense",
      occurredOn: "2026-03-05",
      amount: 10,
      description: "Software",
      category: "software_systems",
      partnerId: null,
      partnerName: null,
      paymentStatus: "paid",
      imported: false,
    },
  ]);
  assert.equal(paidExpense.openObligations, 0);
  assert.equal(paidExpense.operatingResult, 90);
  const unpaidPurchase = obligationView([
    {
      id: "purchase-unpaid",
      kind: "inventory_purchase",
      occurredOn: "2026-03-01",
      amount: 80,
      description: "Pots",
      category: null,
      partnerId: null,
      partnerName: null,
      paymentStatus: "unpaid",
      imported: false,
    },
  ]);
  assert.equal(unpaidPurchase.openObligations, 80);
  assert.equal(unpaidPurchase.operatingResult, 100);
  const paidPurchase = obligationView([
    {
      id: "purchase-paid",
      kind: "inventory_purchase",
      occurredOn: "2026-03-01",
      amount: 25,
      description: "Paid pots",
      category: null,
      partnerId: null,
      partnerName: null,
      paymentStatus: "paid",
      imported: false,
    },
  ]);
  assert.equal(paidPurchase.openObligations, 0);
  assert.equal(paidPurchase.operatingResult, 100);
  const allocated = obligationView(
    [
      {
        id: "purchase-unpaid",
        kind: "inventory_purchase",
        occurredOn: "2026-03-01",
        amount: 80,
        description: "Pots",
        category: null,
        partnerId: null,
        partnerName: null,
        paymentStatus: "unpaid",
        imported: false,
      },
    ],
    {
      allocations: [
        {
          id: "alloc-1",
          purchaseId: "purchase-unpaid",
          occurredOn: "2026-03-06",
          amount: 30,
          description: "To partner",
          partnerId: "partner-1",
          partnerName: "Partner",
          purchaseDescription: "Pots",
          imported: false,
        },
      ],
    },
  );
  assert.equal(allocated.openObligations, unpaidPurchase.openObligations);
  assert.equal(allocated.operatingResult, unpaidPurchase.operatingResult);
  const settlement = obligationView([
    {
      id: "settlement-1",
      kind: "historical_settlement",
      occurredOn: "2026-03-20",
      amount: 500,
      description: "Cardcom",
      category: null,
      partnerId: null,
      partnerName: null,
      paymentStatus: "paid",
      imported: true,
    },
  ]);
  assert.equal(settlement.openObligations, 0);
  assert.equal(settlement.operatingResult, 100);
  const unmatchedOnly = obligationView([], {
    unmatched: [
      {
        id: "attempt-1",
        occurredOn: "2026-03-07",
        month: "2026-03",
        amount: 70,
        channel: "catalog",
        reason: "late_cardcom_success",
        cardcomTransactionId: 99,
        productName: "Monstera",
        partnerId: null,
        partnerName: null,
      },
    ],
  });
  assert.equal(unmatchedOnly.openObligations, 0);
  assert.equal(unmatchedOnly.operatingResult, 100);
  assert.equal(unmatchedOnly.orderRevenue, 100);
  assert.equal(obligationBase.activityRows.filter((row) => row.type === "order").length, 1);
  assert.equal(
    obligationBase.activityRows.filter((row) => row.id.startsWith("entry:")).length,
    0,
  );

  const validBaseline = parseBase44Csv(
    [
      "import_key,record_type,date,amount,description,category,partner_name,payment_status,purchase_import_key",
      "p1,inventory_purchase,2024-01-01,1636,Stock,,,paid,",
      "a1,inventory_allocation,2024-01-02,593,Move,,Partner,,p1",
    ].join("\n"),
  );
  assert.equal(validBaseline.ok, true);
  if (validBaseline.ok) assert.equal(base44InvestmentTotalsMatch(validBaseline.rows), true);
  const saleRow = parseBase44Csv(
    [
      "import_key,record_type,date,amount,description,category,partner_name,payment_status,purchase_import_key",
      "s1,sale,2024-01-01,10,Sale,,,paid,",
    ].join("\n"),
  );
  assert.equal(saleRow.ok, false);
  const unknownCategory = parseBase44Csv(
    [
      "import_key,record_type,date,amount,description,category,partner_name,payment_status,purchase_import_key",
      "e1,expense,2024-01-01,10,Ads,Not a category,,paid,",
    ].join("\n"),
  );
  assert.equal(unknownCategory.ok, false);

  console.log("verify-finance: pure checks ok");

  applyMigration("db/migrations/057_orders_supplier_unit_cost.sql");
  applyMigration("db/migrations/058_finance.sql");

  const { sql } = await import("../lib/db");
  const { appendOrder } = await import("../lib/ordersStorage");
  const { createPartner } = await import("../lib/partnerStorage");
  const {
    FinanceWriteError,
    createFinanceAllocation,
    createFinanceEntry,
    importBase44Entries,
    loadFinanceFacts,
  } = await import("../lib/finance/storage");

  const tag = `verify-finance-${randomUUID()}`;
  const partner = await createPartner({ id: tag, name: tag });
  const partnerOrderId = randomUUID();
  const catalogOrderId = randomUUID();

  try {
    const plantRows = await sql`SELECT id, name FROM plants WHERE COALESCE(inventory_type, 'plants') = 'plants' LIMIT 1`;
    const plant = (plantRows as { id: string; name: string }[])[0];
    assert.ok(plant, "need a plant");
    await appendOrder({
      orderId: partnerOrderId,
      plantId: plant.id,
      plantName: plant.name,
      locationId: null,
      locationName: null,
      locationAddress: null,
      price: 10,
      fullName: tag,
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "pickup",
      orderStatus: "sold",
      source: "online",
      channel: "partner",
      partnerId: partner.id,
      createdAt: "2020-01-15T10:00:00.000Z",
    });
    await sql`
      UPDATE orders
      SET supplier_unit_cost = 12.5,
          supplier_unit_cost_source = 'plants.supplier_price@sale'
      WHERE order_id = ${partnerOrderId}::uuid
    `;
    const stored = (await sql`
      SELECT supplier_unit_cost::float8 AS cost, supplier_unit_cost_source AS source
      FROM orders
      WHERE order_id = ${partnerOrderId}::uuid
    `) as { cost: number; source: string }[];
    assert.equal(Number(stored[0]?.cost), 12.5);
    assert.equal(stored[0]?.source, "plants.supplier_price@sale");

    await appendOrder({
      orderId: catalogOrderId,
      plantId: plant.id,
      plantName: plant.name,
      locationId: null,
      locationName: null,
      locationAddress: null,
      price: 10,
      fullName: tag,
      phone: "0500000000",
      address: "",
      apartmentOrNotes: "",
      fulfillmentMethod: "delivery",
      orderStatus: "sold",
      source: "online",
      channel: "catalog",
      partnerId: null,
      createdAt: "2020-01-15T10:00:00.000Z",
    });
    let catalogCostRejected = false;
    try {
      await sql`
        UPDATE orders
        SET supplier_unit_cost = 1,
            supplier_unit_cost_source = 'plants.supplier_price@sale'
        WHERE order_id = ${catalogOrderId}::uuid
      `;
    } catch {
      catalogCostRejected = true;
    }
    assert.equal(catalogCostRejected, true);

    await createFinanceEntry({
      kind: "expense",
      amount: 40,
      occurredOn: "2020-01-02",
      description: `${tag} expense`,
      category: "marketing_signage",
      partnerId: partner.id,
      paymentStatus: "unpaid",
    });
    await createFinanceEntry({
      kind: "inventory_purchase",
      amount: 80,
      occurredOn: "2020-01-03",
      description: `${tag} purchase`,
      category: null,
      partnerId: null,
      paymentStatus: "paid",
    });
    await createFinanceEntry({
      kind: "expense",
      amount: 6,
      occurredOn: "2020-01-02",
      description: `${tag} paid expense`,
      category: "travel",
      partnerId: null,
      paymentStatus: "paid",
    });
    await createFinanceEntry({
      kind: "inventory_purchase",
      amount: 15,
      occurredOn: "2020-01-03",
      description: `${tag} unpaid purchase`,
      category: null,
      partnerId: null,
      paymentStatus: "unpaid",
    });
    await sql`
      INSERT INTO finance_entries (
        id, kind, amount, occurred_on, description, category, payment_status
      )
      VALUES (
        ${randomUUID()}::uuid,
        'historical_settlement',
        500,
        '2020-01-05'::date,
        ${`${tag} settlement`},
        NULL,
        'paid'
      )
    `;
    const created = await loadFinanceFacts();
    const purchase = created.entries.find((row) => row.description === `${tag} purchase`);
    assert.ok(purchase);
    let overAllocated = false;
    try {
      await createFinanceAllocation(purchase.id, {
        amount: 81,
        occurredOn: "2020-01-04",
        description: `${tag} too much`,
        partnerId: partner.id,
      });
    } catch (error) {
      overAllocated = error instanceof FinanceWriteError;
    }
    assert.equal(overAllocated, true);
    await createFinanceAllocation(purchase.id, {
      amount: 30,
      occurredOn: "2020-01-04",
      description: `${tag} allocation`,
      partnerId: partner.id,
    });
    const loaded = await loadFinanceFacts();
    const after = buildFinanceView(
      {
        orders: loaded.orders.filter(
          (row) => row.id === partnerOrderId || row.id === catalogOrderId,
        ),
        entries: loaded.entries.filter((row) => row.description.includes(tag)),
        allocations: loaded.allocations.filter((row) => row.description.includes(tag)),
        unmatched: [],
      },
      "2020-01",
      "all",
    );
    assert.equal(after.openObligations, 55);
    assert.equal(after.operatingResult, -26);
    assert.equal(after.purchased, 95);
    assert.equal(after.allocated, 30);
    assert.equal(after.remaining, 65);
    assert.equal(after.orderRevenue, 20);
    assert.equal(after.activityRows.filter((row) => row.type === "order").length, 2);
    assert.equal(
      after.activityRows.filter((row) => row.type === "order" && row.id.startsWith("order:")).length,
      2,
    );
    const copiedSales = await sql`
      SELECT count(*)::int AS n
      FROM finance_entries
      WHERE description LIKE ${`%${partnerOrderId}%`}
         OR description LIKE ${`%${catalogOrderId}%`}
    `;
    assert.equal(copiedSales[0]?.n, 0);

    const imported = await importBase44Entries({
      rows: [
        {
          importKey: `${tag}-expense`,
          recordType: "expense",
          occurredOn: "2020-02-01",
          amount: 5,
          description: `${tag} imported expense`,
          category: "travel",
          partnerName: tag,
          paymentStatus: "paid",
          purchaseImportKey: null,
        },
      ],
      partnerIdsByName: { [tag]: partner.id },
    });
    assert.equal(imported.inserted, 1);
    const again = await importBase44Entries({
      rows: [
        {
          importKey: `${tag}-expense`,
          recordType: "expense",
          occurredOn: "2020-02-01",
          amount: 5,
          description: `${tag} imported expense`,
          category: "travel",
          partnerName: tag,
          paymentStatus: "paid",
          purchaseImportKey: null,
        },
      ],
      partnerIdsByName: { [tag]: partner.id },
    });
    assert.equal(again.skipped, 1);
    console.log("verify-finance: database checks ok");
  } finally {
    await sql`DELETE FROM finance_inventory_allocations WHERE description LIKE ${`${tag}%`}`;
    await sql`DELETE FROM finance_entries WHERE description LIKE ${`${tag}%`} OR import_key LIKE ${`${tag}%`}`;
    await sql`DELETE FROM orders WHERE order_id IN (${partnerOrderId}::uuid, ${catalogOrderId}::uuid)`;
    await sql`DELETE FROM partner_commission_tiers WHERE partner_id = ${partner.id}`;
    await sql`DELETE FROM partners WHERE id = ${partner.id}`;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
