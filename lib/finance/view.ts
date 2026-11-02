import { monthKeyFromDate, type FinanceMonth } from "@/lib/finance/period";
import type {
  FinanceActivityFilter,
  FinanceActivityPayment,
  FinanceActivitySource,
  FinanceActivityType,
  FinanceCategory,
  FinanceEntryKind,
  FinancePaymentStatus,
} from "@/lib/finance/types";

export type FinanceOrderFact = {
  id: string;
  occurredOn: string;
  month: string;
  amount: number;
  description: string;
  partnerId: string | null;
  partnerName: string | null;
};

export type FinanceEntryFact = {
  id: string;
  kind: FinanceEntryKind;
  occurredOn: string;
  amount: number;
  description: string;
  category: FinanceCategory | null;
  partnerId: string | null;
  partnerName: string | null;
  paymentStatus: FinancePaymentStatus;
  imported: boolean;
};

export type FinanceAllocationFact = {
  id: string;
  purchaseId: string;
  occurredOn: string;
  amount: number;
  description: string;
  partnerId: string;
  partnerName: string;
  purchaseDescription: string;
  imported: boolean;
};

export type FinanceUnmatchedFact = {
  id: string;
  occurredOn: string;
  month: string;
  amount: number;
  channel: "catalog" | "partner";
  reason: string | null;
  cardcomTransactionId: number | null;
  productName: string;
  partnerId: string | null;
  partnerName: string | null;
};

export type FinanceActivityRow = {
  id: string;
  occurredOn: string;
  type: FinanceActivityType;
  description: string;
  partnerName: string | null;
  category: FinanceCategory | null;
  paymentStatus: FinanceActivityPayment;
  amount: number;
  source: FinanceActivitySource;
};

export type FinancePurchaseRow = {
  id: string;
  occurredOn: string;
  description: string;
  amount: number;
  allocated: number;
  remaining: number;
  partnerName: string | null;
  paymentStatus: FinancePaymentStatus;
  imported: boolean;
};

export type FinancePartnerRow = {
  id: string;
  name: string;
  orderRevenue: number;
  otherIncome: number;
  expenses: number;
  result: number;
  allocated: number;
};

export type FinanceMonthPoint = {
  month: string;
  income: number;
  expenses: number;
};

export type FinanceView = {
  month: FinanceMonth;
  activity: FinanceActivityFilter;
  orderRevenue: number;
  otherIncome: number;
  expenses: number;
  operatingResult: number;
  openObligations: number;
  expensesByCategory: { category: FinanceCategory; amount: number }[];
  monthly: FinanceMonthPoint[];
  partners: FinancePartnerRow[];
  unmatchedCount: number;
  unmatchedAmount: number;
  purchased: number;
  allocated: number;
  remaining: number;
  purchases: FinancePurchaseRow[];
  allocations: FinanceAllocationFact[];
  activityRows: FinanceActivityRow[];
};

export type FinanceFacts = {
  orders: FinanceOrderFact[];
  entries: FinanceEntryFact[];
  allocations: FinanceAllocationFact[];
  unmatched: FinanceUnmatchedFact[];
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(values: number[]): number {
  return money(values.reduce((total, value) => total + value, 0));
}

function inPeriod(month: FinanceMonth, monthKey: string): boolean {
  return month === "all" || month === monthKey;
}

function unmatchedDescription(row: FinanceUnmatchedFact): string {
  const channel = row.channel === "catalog" ? "Catalog" : "Partner";
  const cardcom =
    row.cardcomTransactionId == null ? "Cardcom —" : `Cardcom ${row.cardcomTransactionId}`;
  const reason = row.reason?.trim();
  return [channel, row.productName.trim() || "Payment", cardcom, reason]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

export function buildFinanceView(
  facts: FinanceFacts,
  month: FinanceMonth,
  activity: FinanceActivityFilter,
): FinanceView {
  const periodOrders = facts.orders.filter((row) => inPeriod(month, row.month));
  const periodEntries = facts.entries.filter((row) =>
    inPeriod(month, monthKeyFromDate(row.occurredOn)),
  );
  const periodAllocations = facts.allocations.filter((row) =>
    inPeriod(month, monthKeyFromDate(row.occurredOn)),
  );
  const periodUnmatched = facts.unmatched.filter((row) => inPeriod(month, row.month));

  const orderRevenue = sum(periodOrders.map((row) => row.amount));
  const otherIncome = sum(
    periodEntries.filter((row) => row.kind === "other_income").map((row) => row.amount),
  );
  const expenseRows = periodEntries.filter((row) => row.kind === "expense");
  const expenses = sum(expenseRows.map((row) => row.amount));
  const openObligations = sum(
    periodEntries
      .filter(
        (row) =>
          (row.kind === "expense" || row.kind === "inventory_purchase") &&
          row.paymentStatus === "unpaid",
      )
      .map((row) => row.amount),
  );

  const categoryTotals = new Map<FinanceCategory, number>();
  for (const row of expenseRows) {
    if (!row.category) continue;
    categoryTotals.set(row.category, (categoryTotals.get(row.category) ?? 0) + row.amount);
  }
  const expensesByCategory = [...categoryTotals.entries()]
    .map(([category, amount]) => ({ category, amount: money(amount) }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));

  const monthTotals = new Map<string, { income: number; expenses: number }>();
  function monthBucket(key: string): { income: number; expenses: number } {
    const existing = monthTotals.get(key);
    if (existing) return existing;
    const created = { income: 0, expenses: 0 };
    monthTotals.set(key, created);
    return created;
  }
  for (const row of facts.orders) {
    monthBucket(row.month).income += row.amount;
  }
  for (const row of facts.entries) {
    const key = monthKeyFromDate(row.occurredOn);
    if (row.kind === "other_income") monthBucket(key).income += row.amount;
    if (row.kind === "expense") monthBucket(key).expenses += row.amount;
  }
  const monthly = [...monthTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      month: key,
      income: money(value.income),
      expenses: money(value.expenses),
    }));

  const partners = new Map<string, FinancePartnerRow>();
  function partnerBucket(id: string, name: string): FinancePartnerRow {
    const existing = partners.get(id);
    if (existing) return existing;
    const created: FinancePartnerRow = {
      id,
      name,
      orderRevenue: 0,
      otherIncome: 0,
      expenses: 0,
      result: 0,
      allocated: 0,
    };
    partners.set(id, created);
    return created;
  }
  for (const row of periodOrders) {
    if (!row.partnerId) continue;
    partnerBucket(row.partnerId, row.partnerName ?? row.partnerId).orderRevenue += row.amount;
  }
  for (const row of periodEntries) {
    if (!row.partnerId) continue;
    const bucket = partnerBucket(row.partnerId, row.partnerName ?? row.partnerId);
    if (row.kind === "other_income") bucket.otherIncome += row.amount;
    if (row.kind === "expense") bucket.expenses += row.amount;
  }
  for (const row of periodAllocations) {
    partnerBucket(row.partnerId, row.partnerName).allocated += row.amount;
  }
  const partnerRows = [...partners.values()]
    .map((row) => ({
      ...row,
      orderRevenue: money(row.orderRevenue),
      otherIncome: money(row.otherIncome),
      expenses: money(row.expenses),
      allocated: money(row.allocated),
      result: money(row.orderRevenue + row.otherIncome - row.expenses),
    }))
    .filter(
      (row) =>
        row.orderRevenue !== 0 ||
        row.otherIncome !== 0 ||
        row.expenses !== 0 ||
        row.allocated !== 0,
    )
    .sort((a, b) => b.orderRevenue - a.orderRevenue || a.name.localeCompare(b.name));

  const allocatedByPurchase = new Map<string, number>();
  for (const row of facts.allocations) {
    allocatedByPurchase.set(row.purchaseId, (allocatedByPurchase.get(row.purchaseId) ?? 0) + row.amount);
  }
  const purchases = periodEntries
    .filter((row) => row.kind === "inventory_purchase")
    .map((row) => {
      const allocated = money(allocatedByPurchase.get(row.id) ?? 0);
      return {
        id: row.id,
        occurredOn: row.occurredOn,
        description: row.description,
        amount: row.amount,
        allocated,
        remaining: money(row.amount - allocated),
        partnerName: row.partnerName,
        paymentStatus: row.paymentStatus,
        imported: row.imported,
      };
    })
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || a.description.localeCompare(b.description));

  const purchased = sum(purchases.map((row) => row.amount));
  const allocated = sum(periodAllocations.map((row) => row.amount));

  const activityRows: FinanceActivityRow[] = [
    ...periodOrders.map((row) => ({
      id: `order:${row.id}`,
      occurredOn: row.occurredOn,
      type: "order" as const,
      description: row.description,
      partnerName: row.partnerName,
      category: null,
      paymentStatus: "paid" as const,
      amount: row.amount,
      source: "order" as const,
    })),
    ...periodEntries.map((row) => ({
      id: `entry:${row.id}`,
      occurredOn: row.occurredOn,
      type: row.kind,
      description: row.description,
      partnerName: row.partnerName,
      category: row.category,
      paymentStatus: (row.kind === "historical_settlement" ? "settled" : row.paymentStatus) as FinanceActivityPayment,
      amount: row.amount,
      source: (row.imported ? "import" : "manual") as FinanceActivitySource,
    })),
    ...periodUnmatched.map((row) => ({
      id: `attempt:${row.id}`,
      occurredOn: row.occurredOn,
      type: "unmatched" as const,
      description: unmatchedDescription(row),
      partnerName: row.partnerName,
      category: null,
      paymentStatus: "unmatched" as const,
      amount: row.amount,
      source: "payment_attempt" as const,
    })),
  ]
    .filter((row) => activity === "all" || row.type === activity)
    .sort(
      (a, b) =>
        b.occurredOn.localeCompare(a.occurredOn) ||
        a.type.localeCompare(b.type) ||
        a.id.localeCompare(b.id),
    );

  return {
    month,
    activity,
    orderRevenue,
    otherIncome,
    expenses,
    operatingResult: money(orderRevenue + otherIncome - expenses),
    openObligations,
    expensesByCategory,
    monthly,
    partners: partnerRows,
    unmatchedCount: periodUnmatched.length,
    unmatchedAmount: sum(periodUnmatched.map((row) => row.amount)),
    purchased,
    allocated,
    remaining: money(purchased - allocated),
    purchases,
    allocations: [...periodAllocations].sort(
      (a, b) => b.occurredOn.localeCompare(a.occurredOn) || a.id.localeCompare(b.id),
    ),
    activityRows,
  };
}
