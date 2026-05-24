import type { PartnerLocation } from "@/lib/partnerLocationStorage";
import { parsePartnerPayments } from "@/lib/partnerPayment";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Legacy seed ids (slug-style) remain valid until migrated. */
const LEGACY_PARTNER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PartnerParseResult =
  | { ok: true; partner: PartnerLocation }
  | { ok: false; error: string };

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidPartnerId(id: string): boolean {
  return UUID_PATTERN.test(id) || LEGACY_PARTNER_ID_PATTERN.test(id);
}

function parsePayments(value: unknown): PartnerLocation["payments"] {
  if (value === undefined || value === null) return [];
  return parsePartnerPayments(value);
}

export function parsePartnerBody(
  body: Record<string, unknown>,
  options: { requireId: boolean; existingId?: string },
): PartnerParseResult {
  const id = cleanString(body.id);
  if (options.requireId && !id) {
    return { ok: false, error: "id is required" };
  }
  if (id && !isValidPartnerId(id)) {
    return {
      ok: false,
      error: "id must be a UUID or legacy partner slug",
    };
  }
  if (options.existingId && id && id !== options.existingId) {
    return { ok: false, error: "id cannot be changed" };
  }

  const resolvedId = options.existingId ?? id;
  if (!resolvedId) {
    return { ok: false, error: "id is required" };
  }

  const name = cleanString(body.name);
  const address = cleanString(body.address);
  const type = cleanString(body.type);

  if (!name) return { ok: false, error: "name is required" };
  if (!address) return { ok: false, error: "address is required" };
  if (!type) return { ok: false, error: "type is required" };

  const payments = parsePayments(body.payments);

  const partner: PartnerLocation = {
    id: resolvedId,
    name,
    address,
    type,
    partnerType: type,
    payments,
  };

  return { ok: true, partner };
}
