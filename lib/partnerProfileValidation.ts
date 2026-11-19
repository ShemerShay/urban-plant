export type PartnerProfileFields = {
  monthlyRevenue: number;
  setupCost: number;
  notes: string;
};

type PartnerProfileParseResult =
  | { ok: true; value: PartnerProfileFields }
  | { ok: false; error: string };

function parseNonNegativeNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function withExistingPartnerProfileFields(
  body: Record<string, unknown>,
  existing: PartnerProfileFields,
): Record<string, unknown> {
  return {
    ...body,
    monthlyRevenue: Object.hasOwn(body, "monthlyRevenue")
      ? body.monthlyRevenue
      : existing.monthlyRevenue,
    setupCost: Object.hasOwn(body, "setupCost") ? body.setupCost : existing.setupCost,
    notes: Object.hasOwn(body, "notes") ? body.notes : existing.notes,
  };
}

export function parsePartnerProfileFields(
  body: Record<string, unknown>,
): PartnerProfileParseResult {
  const monthlyRevenue = parseNonNegativeNumber(body.monthlyRevenue);
  if (monthlyRevenue === null) {
    return { ok: false, error: "monthlyRevenue must be a non-negative number" };
  }
  const setupCost = parseNonNegativeNumber(body.setupCost);
  if (setupCost === null) {
    return { ok: false, error: "setupCost must be a non-negative number" };
  }

  return {
    ok: true,
    value: {
      monthlyRevenue,
      setupCost,
      notes: typeof body.notes === "string" ? body.notes.trim() : "",
    },
  };
}
