import { isCalendarDate } from "@/lib/finance/period";
import {
  isFinancePaymentStatus,
  type FinanceCategory,
  type FinancePaymentStatus,
} from "@/lib/finance/types";

export const BASE44_INVESTMENT_TOTALS = {
  purchased: 1636,
  allocated: 593,
  remaining: 1043,
} as const;

const CATEGORY_LABELS: Record<string, FinanceCategory> = {
  Inventory: "inventory",
  מלאי: "inventory",
  Setup: "setup_fixtures",
  "Setup & fixtures": "setup_fixtures",
  הקמה: "setup_fixtures",
  "ציוד והקמה": "setup_fixtures",
  Marketing: "marketing_signage",
  "Marketing & signage": "marketing_signage",
  שיווק: "marketing_signage",
  שילוט: "marketing_signage",
  Software: "software_systems",
  "Software & systems": "software_systems",
  תוכנה: "software_systems",
  מערכות: "software_systems",
  "Professional services": "professional_services",
  "שירותים מקצועיים": "professional_services",
  "הנהלת חשבונות": "professional_services",
  Maintenance: "maintenance_tools",
  "Maintenance & tools": "maintenance_tools",
  תחזוקה: "maintenance_tools",
  כלים: "maintenance_tools",
  Travel: "travel",
  נסיעות: "travel",
  Other: "other",
  אחר: "other",
};

const REQUIRED_COLUMNS = [
  "import_key",
  "record_type",
  "date",
  "amount",
  "description",
  "category",
  "partner_name",
  "payment_status",
  "purchase_import_key",
] as const;

export type Base44EntryType =
  | "expense"
  | "other_income"
  | "inventory_purchase"
  | "historical_settlement";

export type Base44Row = {
  importKey: string;
  recordType: Base44EntryType | "inventory_allocation";
  occurredOn: string;
  amount: number;
  description: string;
  category: FinanceCategory | null;
  partnerName: string | null;
  paymentStatus: FinancePaymentStatus | null;
  purchaseImportKey: string | null;
};

export type Base44ParseResult = { ok: true; rows: Base44Row[] } | { ok: false; errors: string[] };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char !== "\r") field += char;
  }
  if (quoted) return [];
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function parseAmount(value: string): number | null {
  const normalized = value.trim().replace(/[₪,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

export function parseBase44Csv(text: string): Base44ParseResult {
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, errors: ["CSV must include a header and one row"] };
  const header = table[0]?.map((cell) => cell.trim()) ?? [];
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return { ok: false, errors: [`Missing columns: ${missing.join(", ")}`] };
  }
  const index = new Map(header.map((name, position) => [name, position]));
  const errors: string[] = [];
  const rows: Base44Row[] = [];
  const seen = new Set<string>();
  const purchaseAmounts = new Map<string, number>();

  function cell(cells: string[], name: (typeof REQUIRED_COLUMNS)[number]): string {
    return (cells[index.get(name) ?? -1] ?? "").trim();
  }

  for (let line = 1; line < table.length; line += 1) {
    const cells = table[line] ?? [];
    const label = `Row ${line + 1}`;
    const importKey = cell(cells, "import_key");
    const recordType = cell(cells, "record_type");
    const occurredOn = cell(cells, "date");
    const amount = parseAmount(cell(cells, "amount"));
    const description = cell(cells, "description");
    const categoryLabel = cell(cells, "category");
    const partnerName = cell(cells, "partner_name");
    const paymentRaw = cell(cells, "payment_status");
    const purchaseImportKey = cell(cells, "purchase_import_key");

    if (!importKey) errors.push(`${label}: import_key is required`);
    else if (seen.has(importKey)) errors.push(`${label}: duplicate import_key ${importKey}`);
    else seen.add(importKey);
    if (!isCalendarDate(occurredOn)) errors.push(`${label}: date must be YYYY-MM-DD`);
    if (amount == null) errors.push(`${label}: amount must be a positive shekel amount`);
    if (!description) errors.push(`${label}: description is required`);

    const known =
      recordType === "expense" ||
      recordType === "other_income" ||
      recordType === "inventory_purchase" ||
      recordType === "historical_settlement" ||
      recordType === "inventory_allocation";
    if (!known) {
      errors.push(`${label}: record_type ${recordType || "blank"} cannot be imported`);
      continue;
    }

    let category: FinanceCategory | null = null;
    let paymentStatus: FinancePaymentStatus | null = null;
    if (recordType === "expense") {
      category = CATEGORY_LABELS[categoryLabel] ?? null;
      if (!category) errors.push(`${label}: unknown category ${categoryLabel || "blank"}`);
      if (!isFinancePaymentStatus(paymentRaw)) {
        errors.push(`${label}: payment_status must be paid or unpaid`);
      } else {
        paymentStatus = paymentRaw;
      }
      if (purchaseImportKey) errors.push(`${label}: purchase_import_key must be empty`);
    } else if (recordType === "inventory_allocation") {
      if (categoryLabel) errors.push(`${label}: category must be empty`);
      if (paymentRaw) errors.push(`${label}: payment_status must be empty`);
      if (!partnerName) errors.push(`${label}: partner_name is required`);
      if (!purchaseImportKey) errors.push(`${label}: purchase_import_key is required`);
    } else {
      if (categoryLabel) errors.push(`${label}: category must be empty`);
      if (purchaseImportKey) errors.push(`${label}: purchase_import_key must be empty`);
      if (recordType === "historical_settlement") {
        if (paymentRaw && paymentRaw !== "paid") {
          errors.push(`${label}: historical settlements are paid`);
        }
        paymentStatus = "paid";
      } else if (!isFinancePaymentStatus(paymentRaw)) {
        errors.push(`${label}: payment_status must be paid or unpaid`);
      } else {
        paymentStatus = paymentRaw;
      }
    }

    if (recordType === "inventory_purchase" && importKey && amount != null) {
      purchaseAmounts.set(importKey, amount);
    }

    rows.push({
      importKey,
      recordType,
      occurredOn,
      amount: amount ?? 0,
      description,
      category,
      partnerName: partnerName || null,
      paymentStatus,
      purchaseImportKey: purchaseImportKey || null,
    });
  }

  const allocatedByPurchase = new Map<string, number>();
  for (const row of rows) {
    if (row.recordType !== "inventory_allocation" || !row.purchaseImportKey) continue;
    if (!purchaseAmounts.has(row.purchaseImportKey)) {
      errors.push(`Allocation ${row.importKey} has no purchase ${row.purchaseImportKey} in the file`);
      continue;
    }
    allocatedByPurchase.set(
      row.purchaseImportKey,
      (allocatedByPurchase.get(row.purchaseImportKey) ?? 0) + row.amount,
    );
  }
  for (const [purchaseKey, allocated] of allocatedByPurchase) {
    const purchased = purchaseAmounts.get(purchaseKey) ?? 0;
    if (Math.round(allocated * 100) > Math.round(purchased * 100)) {
      errors.push(`Allocation exceeds purchase ${purchaseKey}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}

export function base44InvestmentTotals(rows: Base44Row[]): {
  purchased: number;
  allocated: number;
  remaining: number;
} {
  const purchased = rows
    .filter((row) => row.recordType === "inventory_purchase")
    .reduce((total, row) => total + row.amount, 0);
  const allocated = rows
    .filter((row) => row.recordType === "inventory_allocation")
    .reduce((total, row) => total + row.amount, 0);
  return {
    purchased: Math.round(purchased * 100) / 100,
    allocated: Math.round(allocated * 100) / 100,
    remaining: Math.round((purchased - allocated) * 100) / 100,
  };
}

export function base44InvestmentTotalsMatch(rows: Base44Row[]): boolean {
  const totals = base44InvestmentTotals(rows);
  return (
    totals.purchased === BASE44_INVESTMENT_TOTALS.purchased &&
    totals.allocated === BASE44_INVESTMENT_TOTALS.allocated &&
    totals.remaining === BASE44_INVESTMENT_TOTALS.remaining
  );
}
