export type PartnerBrandParseResult =
  | { ok: true; value: { name: string } }
  | { ok: false; error: string };

export function parsePartnerBrandBody(body: Record<string, unknown>): PartnerBrandParseResult {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };
  return { ok: true, value: { name } };
}
