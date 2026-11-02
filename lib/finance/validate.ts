import { isCalendarDate } from "@/lib/finance/period";
import {
  isFinanceCategory,
  isFinancePaymentStatus,
  isManualFinanceKind,
  type FinanceCategory,
  type FinancePaymentStatus,
  type ManualFinanceKind,
} from "@/lib/finance/types";

export type ManualFinanceEntryInput = {
  kind: ManualFinanceKind;
  amount: number;
  occurredOn: string;
  description: string;
  category: FinanceCategory | null;
  partnerId: string | null;
  paymentStatus: FinancePaymentStatus;
};

export type FinanceAllocationInput = {
  amount: number;
  occurredOn: string;
  description: string;
  partnerId: string;
};

export type FinanceParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseAmount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) return null;
  return cents / 100;
}

function parseDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const description = value.trim();
  if (!description || description.length > 500) return null;
  return description;
}

function parsePartnerId(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const partnerId = value.trim();
  return partnerId ? partnerId : null;
}

export function parseManualFinanceEntry(
  body: Record<string, unknown>,
): FinanceParseResult<ManualFinanceEntryInput> {
  if (!isManualFinanceKind(body.kind)) {
    return { ok: false, error: "Type must be an expense, other income, or inventory purchase" };
  }
  const amount = parseAmount(body.amount);
  if (amount == null) return { ok: false, error: "Amount must be a positive amount in shekels" };
  if (typeof body.occurredOn !== "string" || !isCalendarDate(body.occurredOn)) {
    return { ok: false, error: "Date is required" };
  }
  const description = parseDescription(body.description);
  if (!description) return { ok: false, error: "Description is required" };
  if (!isFinancePaymentStatus(body.paymentStatus)) {
    return { ok: false, error: "Payment status must be paid or unpaid" };
  }
  const partnerId = parsePartnerId(body.partnerId);
  if (partnerId === undefined) return { ok: false, error: "Partner is not valid" };

  if (body.kind === "expense") {
    if (!isFinanceCategory(body.category)) {
      return { ok: false, error: "Category is required" };
    }
    return {
      ok: true,
      value: {
        kind: body.kind,
        amount,
        occurredOn: body.occurredOn,
        description,
        category: body.category,
        partnerId,
        paymentStatus: body.paymentStatus,
      },
    };
  }

  if (body.category != null && body.category !== "") {
    return { ok: false, error: "Category is only used for expenses" };
  }
  return {
    ok: true,
    value: {
      kind: body.kind,
      amount,
      occurredOn: body.occurredOn,
      description,
      category: null,
      partnerId,
      paymentStatus: body.paymentStatus,
    },
  };
}

export function parseFinanceAllocation(
  body: Record<string, unknown>,
): FinanceParseResult<FinanceAllocationInput> {
  const amount = parseAmount(body.amount);
  if (amount == null) return { ok: false, error: "Amount must be a positive amount in shekels" };
  if (typeof body.occurredOn !== "string" || !isCalendarDate(body.occurredOn)) {
    return { ok: false, error: "Date is required" };
  }
  const description = parseDescription(body.description);
  if (!description) return { ok: false, error: "Description is required" };
  const partnerId = parsePartnerId(body.partnerId);
  if (!partnerId) return { ok: false, error: "Partner is required" };
  return { ok: true, value: { amount, occurredOn: body.occurredOn, description, partnerId } };
}
