/** Payment record stored in `partner_locations.payments` (jsonb array). */
export interface PartnerPaymentRecord {
  when_paid: string;
  how_much: number;
  who: string;
}

export function parsePartnerPayments(value: unknown): PartnerPaymentRecord[] {
  if (!Array.isArray(value)) return [];

  const records: PartnerPaymentRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const when_paid = typeof row.when_paid === "string" ? row.when_paid.trim() : "";
    const who = typeof row.who === "string" ? row.who.trim() : "";
    const how_much =
      typeof row.how_much === "number"
        ? row.how_much
        : typeof row.how_much === "string"
          ? Number(row.how_much)
          : NaN;

    if (when_paid && who && Number.isFinite(how_much)) {
      records.push({ when_paid, how_much, who });
    }
  }
  return records;
}
