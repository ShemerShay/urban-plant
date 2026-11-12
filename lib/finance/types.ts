export const FINANCE_CATEGORIES = [
  "inventory",
  "setup_fixtures",
  "marketing_signage",
  "software_systems",
  "professional_services",
  "maintenance_tools",
  "travel",
  "other",
] as const;

export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

export const FINANCE_ENTRY_KINDS = [
  "expense",
  "other_income",
  "inventory_purchase",
  "historical_settlement",
] as const;

export type FinanceEntryKind = (typeof FINANCE_ENTRY_KINDS)[number];

export const MANUAL_FINANCE_KINDS = ["expense", "other_income", "inventory_purchase"] as const;

export type ManualFinanceKind = (typeof MANUAL_FINANCE_KINDS)[number];

export const FINANCE_ACTIVITY_FILTERS = [
  "all",
  "order",
  "expense",
  "other_income",
  "inventory_purchase",
  "historical_settlement",
  "unmatched",
] as const;

export type FinanceActivityFilter = (typeof FINANCE_ACTIVITY_FILTERS)[number];

export type FinancePaymentStatus = "unpaid" | "paid";

export type FinanceActivityType = Exclude<FinanceActivityFilter, "all">;

export type FinanceActivitySource = "order" | "manual" | "import" | "payment_attempt";

export type FinanceActivityPayment = FinancePaymentStatus | "unmatched" | "settled";

export function isFinanceCategory(value: unknown): value is FinanceCategory {
  return typeof value === "string" && (FINANCE_CATEGORIES as readonly string[]).includes(value);
}

export function isFinanceEntryKind(value: unknown): value is FinanceEntryKind {
  return typeof value === "string" && (FINANCE_ENTRY_KINDS as readonly string[]).includes(value);
}

export function isManualFinanceKind(value: unknown): value is ManualFinanceKind {
  return typeof value === "string" && (MANUAL_FINANCE_KINDS as readonly string[]).includes(value);
}

export function isFinanceActivityFilter(value: unknown): value is FinanceActivityFilter {
  return (
    typeof value === "string" && (FINANCE_ACTIVITY_FILTERS as readonly string[]).includes(value)
  );
}

export function isFinancePaymentStatus(value: unknown): value is FinancePaymentStatus {
  return value === "unpaid" || value === "paid";
}
