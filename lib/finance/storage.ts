import "server-only";

import { randomUUID } from "node:crypto";

import type { Base44Row } from "@/lib/finance/base44Csv";
import { buildFinanceView, type FinanceEntryFact, type FinanceFacts, type FinanceView } from "@/lib/finance/view";
import type { FinanceMonth } from "@/lib/finance/period";
import {
  isFinanceCategory,
  isFinanceEntryKind,
  isFinancePaymentStatus,
  type FinanceActivityFilter,
  type FinanceCategory,
} from "@/lib/finance/types";
import type { FinanceAllocationInput, ManualFinanceEntryInput } from "@/lib/finance/validate";
import { sql } from "@/lib/db";
import { getPartnerById } from "@/lib/partnerStorage";

export class FinanceWriteError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "FinanceWriteError";
    this.status = status;
  }
}

type EntryRow = {
  id: string;
  kind: string;
  amount: string | number;
  occurred_on: string;
  description: string;
  category: string | null;
  partner_id: string | null;
  partner_name: string | null;
  payment_status: string;
  import_key: string | null;
};

type AllocationRow = {
  id: string;
  purchase_id: string;
  amount: string | number;
  occurred_on: string;
  description: string;
  partner_id: string;
  partner_name: string;
  purchase_description: string;
  import_key: string | null;
};

type OrderRow = {
  order_id: string;
  price: string | number;
  product_name: string;
  occurred_on: string;
  partner_id: string | null;
  partner_name: string | null;
};

type UnmatchedRow = {
  id: string;
  channel: string;
  amount: string | number;
  occurred_on: string;
  failure_reason: string | null;
  cardcom_transaction_id: string | number | bigint | null;
  product_name: string;
  partner_id: string | null;
  partner_name: string | null;
};

function moneyValue(value: string | number): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) throw new Error("Finance amount is not a number");
  return Math.round(amount * 100) / 100;
}

function databaseErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function rethrowFinanceWrite(error: unknown): never {
  const message = databaseErrorText(error);
  if (message.includes("allocation exceeds purchase amount")) {
    throw new FinanceWriteError(400, "Allocation exceeds the remaining purchase amount");
  }
  if (message.includes("allocation purchase must be an inventory purchase")) {
    throw new FinanceWriteError(400, "Allocations belong to an inventory purchase");
  }
  if (message.includes("finance_inventory_allocations_purchase_id_fkey") || message.includes("violates foreign key")) {
    throw new FinanceWriteError(409, "Remove allocations before removing this purchase");
  }
  throw error;
}

async function assertPartner(partnerId: string | null): Promise<void> {
  if (!partnerId) return;
  const partner = await getPartnerById(partnerId);
  if (!partner) throw new FinanceWriteError(400, "Partner was not found");
}

function mapEntry(row: EntryRow): FinanceEntryFact {
  const kind = row.kind;
  const paymentStatus = row.payment_status;
  if (!isFinanceEntryKind(kind) || !isFinancePaymentStatus(paymentStatus)) {
    throw new Error("Finance entry is invalid");
  }
  let category: FinanceCategory | null = null;
  if (row.category != null) {
    if (!isFinanceCategory(row.category)) throw new Error("Finance category is invalid");
    category = row.category;
  }
  return {
    id: row.id,
    kind,
    occurredOn: row.occurred_on,
    amount: moneyValue(row.amount),
    description: row.description,
    category,
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    paymentStatus,
    imported: row.import_key != null,
  };
}

export async function loadFinanceFacts(): Promise<FinanceFacts> {
  const [orders, entries, allocations, unmatched] = await Promise.all([
    sql`
      SELECT
        o.order_id,
        o.price,
        o.product_name,
        to_char(timezone('Asia/Jerusalem', o.created_at), 'YYYY-MM-DD') AS occurred_on,
        o.partner_id,
        pr.name AS partner_name
      FROM orders o
      LEFT JOIN partners pr ON pr.id = o.partner_id
      WHERE o.is_internal = false
        AND o.order_status IN ('sold', 'picked_up', 'delivered')
    `,
    sql`
      SELECT
        e.id::text AS id,
        e.kind,
        e.amount,
        to_char(e.occurred_on, 'YYYY-MM-DD') AS occurred_on,
        e.description,
        e.category,
        e.partner_id,
        pr.name AS partner_name,
        e.payment_status,
        e.import_key
      FROM finance_entries e
      LEFT JOIN partners pr ON pr.id = e.partner_id
    `,
    sql`
      SELECT
        a.id::text AS id,
        a.purchase_id::text AS purchase_id,
        a.amount,
        to_char(a.occurred_on, 'YYYY-MM-DD') AS occurred_on,
        a.description,
        a.partner_id,
        pr.name AS partner_name,
        e.description AS purchase_description,
        a.import_key
      FROM finance_inventory_allocations a
      INNER JOIN finance_entries e ON e.id = a.purchase_id
      INNER JOIN partners pr ON pr.id = a.partner_id
    `,
    sql`
      SELECT
        a.id::text AS id,
        a.channel,
        a.amount,
        to_char(timezone('Asia/Jerusalem', a.created_at), 'YYYY-MM-DD') AS occurred_on,
        a.failure_reason,
        a.cardcom_transaction_id,
        a.product_name,
        pr.id AS partner_id,
        pr.name AS partner_name
      FROM payment_attempts a
      LEFT JOIN pos_spots p ON p.id = a.pos_spot_id
      LEFT JOIN partner_locations loc ON loc.id = COALESCE(
        NULLIF(btrim(a.snapshot->>'partnerLocationId'), ''),
        p.partner_location_id
      )
      LEFT JOIN partners pr ON pr.id = loc.partner_id
      WHERE a.is_internal = false
        AND a.status = 'needs_reconciliation'
        AND a.finalized_order_id IS NULL
    `,
  ]);

  return {
    orders: (orders as OrderRow[]).map((row) => ({
      id: row.order_id,
      occurredOn: row.occurred_on,
      month: row.occurred_on.slice(0, 7),
      amount: moneyValue(row.price),
      description: row.product_name,
      partnerId: row.partner_id,
      partnerName: row.partner_name,
    })),
    entries: (entries as EntryRow[]).map(mapEntry),
    allocations: (allocations as AllocationRow[]).map((row) => ({
      id: row.id,
      purchaseId: row.purchase_id,
      occurredOn: row.occurred_on,
      amount: moneyValue(row.amount),
      description: row.description,
      partnerId: row.partner_id,
      partnerName: row.partner_name,
      purchaseDescription: row.purchase_description,
      imported: row.import_key != null,
    })),
    unmatched: (unmatched as UnmatchedRow[]).flatMap((row) => {
      if (row.channel !== "catalog" && row.channel !== "partner") return [];
      const transactionId =
        row.cardcom_transaction_id == null || row.cardcom_transaction_id === ""
          ? null
          : Number(row.cardcom_transaction_id);
      return [
        {
          id: row.id,
          occurredOn: row.occurred_on,
          month: row.occurred_on.slice(0, 7),
          amount: moneyValue(row.amount),
          channel: row.channel,
          reason: row.failure_reason,
          cardcomTransactionId:
            transactionId != null && Number.isFinite(transactionId) ? transactionId : null,
          productName: row.product_name,
          partnerId: row.partner_id,
          partnerName: row.partner_name,
        },
      ];
    }),
  };
}

export async function loadFinanceView(
  month: FinanceMonth,
  activity: FinanceActivityFilter,
): Promise<FinanceView> {
  return buildFinanceView(await loadFinanceFacts(), month, activity);
}

export async function createFinanceEntry(input: ManualFinanceEntryInput): Promise<void> {
  await assertPartner(input.partnerId);
  const id = randomUUID();
  await sql`
    INSERT INTO finance_entries (
      id, kind, amount, occurred_on, description, category, partner_id, payment_status
    )
    VALUES (
      ${id}::uuid,
      ${input.kind},
      ${input.amount},
      ${input.occurredOn}::date,
      ${input.description},
      ${input.category},
      ${input.partnerId},
      ${input.paymentStatus}
    )
  `;
}

export async function deleteManualFinanceEntry(id: string): Promise<void> {
  try {
    const rows = await sql`
      DELETE FROM finance_entries
      WHERE id = ${id}::uuid
        AND import_key IS NULL
        AND kind <> 'historical_settlement'
      RETURNING id
    `;
    if ((rows as unknown[]).length === 0) {
      throw new FinanceWriteError(404, "Transaction was not found");
    }
  } catch (error) {
    if (error instanceof FinanceWriteError) throw error;
    rethrowFinanceWrite(error);
  }
}

export async function createFinanceAllocation(
  purchaseId: string,
  input: FinanceAllocationInput,
): Promise<void> {
  await assertPartner(input.partnerId);
  const id = randomUUID();
  try {
    const rows = await sql.transaction([
      sql`
        SELECT id
        FROM finance_entries
        WHERE id = ${purchaseId}::uuid
          AND kind = 'inventory_purchase'
        FOR UPDATE
      `,
      sql`
        INSERT INTO finance_inventory_allocations (
          id, purchase_id, partner_id, amount, occurred_on, description
        )
        SELECT
          ${id}::uuid,
          ${purchaseId}::uuid,
          ${input.partnerId},
          ${input.amount},
          ${input.occurredOn}::date,
          ${input.description}
        WHERE EXISTS (
          SELECT 1
          FROM finance_entries
          WHERE id = ${purchaseId}::uuid
            AND kind = 'inventory_purchase'
        )
        RETURNING id
      `,
    ]);
    const inserted = rows[1] as unknown[];
    if (!inserted || inserted.length === 0) {
      throw new FinanceWriteError(404, "Inventory purchase was not found");
    }
  } catch (error) {
    if (error instanceof FinanceWriteError) throw error;
    rethrowFinanceWrite(error);
  }
}

export async function deleteManualFinanceAllocation(id: string): Promise<void> {
  const rows = await sql`
    DELETE FROM finance_inventory_allocations
    WHERE id = ${id}::uuid
      AND import_key IS NULL
    RETURNING id
  `;
  if ((rows as unknown[]).length === 0) {
    throw new FinanceWriteError(404, "Allocation was not found");
  }
}

type StoredKey = { import_key: string; id: string; kind?: string };

export async function importBase44Entries(input: {
  rows: Base44Row[];
  partnerIdsByName: Record<string, string>;
}): Promise<{ inserted: number; skipped: number }> {
  const names = new Set(
    input.rows.map((row) => row.partnerName).filter((name): name is string => Boolean(name)),
  );
  for (const name of names) {
    if (!input.partnerIdsByName[name]?.trim()) {
      throw new FinanceWriteError(400, `No partner alias for ${name}`);
    }
  }
  const aliasIds = [...new Set(Object.values(input.partnerIdsByName).map((id) => id.trim()))].filter(
    Boolean,
  );
  if (aliasIds.length > 0) {
    const found = await sql`
      SELECT id
      FROM partners
      WHERE id = ANY(${aliasIds}::text[])
    `;
    const foundIds = new Set((found as { id: string }[]).map((row) => row.id));
    for (const id of aliasIds) {
      if (!foundIds.has(id)) throw new FinanceWriteError(400, "A partner alias does not match a Partner");
    }
  }

  const [entryKeys, allocationKeys] = await Promise.all([
    sql`SELECT import_key, id::text AS id, kind FROM finance_entries WHERE import_key IS NOT NULL`,
    sql`SELECT import_key, id::text AS id FROM finance_inventory_allocations WHERE import_key IS NOT NULL`,
  ]);
  const existingEntries = new Map(
    (entryKeys as StoredKey[]).map((row) => [row.import_key, { id: row.id, kind: row.kind ?? "" }]),
  );
  const existingAllocations = new Set((allocationKeys as StoredKey[]).map((row) => row.import_key));

  const purchaseIds = new Map<string, string>();
  for (const [key, row] of existingEntries) {
    if (row.kind === "inventory_purchase") purchaseIds.set(key, row.id);
  }
  for (const row of input.rows) {
    if (row.recordType === "inventory_purchase" && !purchaseIds.has(row.importKey)) {
      purchaseIds.set(row.importKey, randomUUID());
    }
  }

  const entryInserts = [];
  const allocationInserts = [];
  let skipped = 0;
  for (const row of input.rows) {
    if (row.recordType === "inventory_allocation") {
      if (existingAllocations.has(row.importKey)) {
        skipped += 1;
        continue;
      }
      const purchaseId = row.purchaseImportKey ? purchaseIds.get(row.purchaseImportKey) : undefined;
      const partnerId = row.partnerName ? input.partnerIdsByName[row.partnerName]?.trim() : "";
      if (!purchaseId || !partnerId) {
        throw new FinanceWriteError(400, `Allocation ${row.importKey} is missing a purchase or Partner`);
      }
      allocationInserts.push(sql`
        INSERT INTO finance_inventory_allocations (
          id, purchase_id, partner_id, amount, occurred_on, description, import_key
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${purchaseId}::uuid,
          ${partnerId},
          ${row.amount},
          ${row.occurredOn}::date,
          ${row.description},
          ${row.importKey}
        )
      `);
      continue;
    }
    if (existingEntries.has(row.importKey)) {
      skipped += 1;
      continue;
    }
    const partnerId = row.partnerName ? input.partnerIdsByName[row.partnerName]?.trim() ?? null : null;
    const id =
      row.recordType === "inventory_purchase"
        ? purchaseIds.get(row.importKey) ?? randomUUID()
        : randomUUID();
    entryInserts.push(sql`
      INSERT INTO finance_entries (
        id, kind, amount, occurred_on, description, category, partner_id, payment_status, import_key
      )
      VALUES (
        ${id}::uuid,
        ${row.recordType},
        ${row.amount},
        ${row.occurredOn}::date,
        ${row.description},
        ${row.category},
        ${partnerId},
        ${row.paymentStatus},
        ${row.importKey}
      )
    `);
  }

  const statements = [...entryInserts, ...allocationInserts];
  if (statements.length > 0) {
    try {
      await sql.transaction(statements);
    } catch (error) {
      rethrowFinanceWrite(error);
    }
  }
  return { inserted: statements.length, skipped };
}
