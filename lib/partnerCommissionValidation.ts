export type ParsedCommissionTier = {
  minUnits: number;
  maxUnits: number | null;
  commissionRate: number;
};

export type PartnerCommissionParseResult =
  | { ok: true; value: ParsedCommissionTier[] }
  | { ok: false; error: string };

function parseUnit(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function parseRate(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function parsePartnerCommissionTiersBody(
  body: Record<string, unknown>,
): PartnerCommissionParseResult {
  const raw = body.tiers;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "tiers must be a non-empty array" };
  }

  const tiers: ParsedCommissionTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "each tier must be an object" };
    }
    const row = item as Record<string, unknown>;
    const minUnits = parseUnit(row.minUnits ?? row.min_units);
    if (minUnits == null || minUnits < 1) {
      return { ok: false, error: "minUnits must be an integer >= 1" };
    }
    const maxRaw = row.maxUnits ?? row.max_units;
    const maxUnits =
      maxRaw == null || maxRaw === ""
        ? null
        : parseUnit(maxRaw);
    if (maxRaw != null && maxRaw !== "" && maxUnits == null) {
      return { ok: false, error: "maxUnits must be an integer or null" };
    }
    if (maxUnits != null && maxUnits < minUnits) {
      return { ok: false, error: "maxUnits must be >= minUnits" };
    }
    const commissionRate = parseRate(row.commissionRate ?? row.commission_rate);
    if (commissionRate == null || commissionRate < 0 || commissionRate > 100) {
      return { ok: false, error: "commissionRate must be a number from 0 to 100" };
    }
    tiers.push({ minUnits, maxUnits, commissionRate });
  }

  const sorted = [...tiers].sort((a, b) => a.minUnits - b.minUnits);
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (!next) continue;
    const currentEnd = current.maxUnits ?? Number.POSITIVE_INFINITY;
    if (currentEnd >= next.minUnits) {
      return { ok: false, error: "tiers must not overlap" };
    }
  }

  return { ok: true, value: sorted };
}
