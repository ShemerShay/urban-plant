import { TEL_AVIV_CITY, TEL_AVIV_STREET_SET, TEL_AVIV_STREETS } from "@/constants/telAvivStreets";

export { TEL_AVIV_CITY, TEL_AVIV_STREETS };

export const DELIVERY_ADDRESS_PILOT_HINT =
  "Currently we deliver only in Tel Aviv. For special delivery requests, contact us on WhatsApp from the plant page.";

export interface StructuredDeliveryAddress {
  city: typeof TEL_AVIV_CITY;
  street: string;
  houseNumber: string;
}

/** Single-line stored address: `Tel Aviv, Rothschild Blvd 12` */
export function formatDeliveryAddressLine(input: {
  city?: string;
  street: string;
  houseNumber: string;
}): string {
  const city = (input.city ?? TEL_AVIV_CITY).trim();
  const street = input.street.trim();
  const houseNumber = input.houseNumber.trim();
  return `${city}, ${street} ${houseNumber}`;
}

/** Readable display for order summaries (legacy rows pass through unchanged). */
export function formatOrderDeliveryAddressDisplay(order: {
  address: string;
  apartmentOrNotes?: string;
}): string {
  const base = order.address?.trim();
  const note = order.apartmentOrNotes?.trim();
  if (!base) return note ? `note: ${note}` : "—";
  if (!note) return base;
  return `${base}, note: ${note}`;
}

export function isTelAvivStreet(street: string): boolean {
  return TEL_AVIV_STREET_SET.has(street.trim());
}

/**
 * Resolves delivery address from API body.
 * Prefers structured `deliveryStreet` + `deliveryHouseNumber`; falls back to legacy `address`.
 */
export function resolveDeliveryAddressFromRequest(record: Record<string, unknown>): {
  address: string;
  error?: string;
} {
  const legacyAddress = typeof record.address === "string" ? record.address.trim() : "";
  const street = typeof record.deliveryStreet === "string" ? record.deliveryStreet.trim() : "";
  const houseNumber =
    typeof record.deliveryHouseNumber === "string" ? record.deliveryHouseNumber.trim() : "";

  if (street || houseNumber) {
    if (!street) {
      return { address: "", error: "deliveryStreet is required" };
    }
    if (!houseNumber) {
      return { address: "", error: "deliveryHouseNumber is required" };
    }
    if (!isTelAvivStreet(street)) {
      return { address: "", error: "deliveryStreet is not valid" };
    }
    return {
      address: formatDeliveryAddressLine({ street, houseNumber }),
    };
  }

  if (legacyAddress) {
    return { address: legacyAddress };
  }

  return { address: "", error: "address is required" };
}
