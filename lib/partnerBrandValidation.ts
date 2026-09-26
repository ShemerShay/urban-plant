export type PartnerBrandParseResult =
  | { ok: true; value: { name: string; image: string | null } }
  | { ok: false; error: string };

const MAX_IMAGE_URL_LENGTH = 2048;

function parseImage(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_IMAGE_URL_LENGTH) return undefined;
  if (!trimmed.startsWith("/") && !trimmed.startsWith("https://")) return undefined;
  return trimmed;
}

export function parsePartnerBrandBody(body: Record<string, unknown>): PartnerBrandParseResult {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };
  const image = parseImage(body.image);
  if (image === undefined) {
    return { ok: false, error: "image must be a site path or https URL" };
  }
  return { ok: true, value: { name, image } };
}
