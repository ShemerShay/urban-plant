const FINANCE_TIME_ZONE = "Asia/Jerusalem";

export type FinanceMonth = "all" | `${number}-${number}`;

export function financeMonthKey(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FINANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    throw new Error("Could not resolve Jerusalem calendar month");
  }
  return `${year}-${month}`;
}

export function isFinanceMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

export function parseFinanceMonth(value: string | undefined, now = new Date()): FinanceMonth {
  if (value === "all") return "all";
  if (value && isFinanceMonth(value)) return value as FinanceMonth;
  return financeMonthKey(now) as FinanceMonth;
}

export function monthKeyFromDate(occurredOn: string): string {
  return occurredOn.slice(0, 7);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
