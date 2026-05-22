/** ISO string from Postgres timestamptz (string or Date). */
export function toIsoString(value: string | Date | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** YYYY-MM-DD from Postgres `date` or timestamptz (calendar day in UTC for the latter). */
export function toIsoDateString(value: string | Date | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/** UTC calendar date YYYY-MM-DD (for comparing `next_check` stored as date). */
export function utcCalendarDateString(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Add days to a YYYY-MM-DD string, returning YYYY-MM-DD in UTC. */
export function addCalendarDaysUtc(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseNumeric(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
