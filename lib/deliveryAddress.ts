import { TEL_AVIV_CITY, TEL_AVIV_STREET_SET, TEL_AVIV_STREETS } from "@/constants/telAvivStreets";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { t } from "@/lib/messages";

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

/**
 * Best-effort reverse of {@link formatDeliveryAddressLine} for edit forms.
 * Matches the longest known Tel Aviv street; unmatched legacy text is returned as street only.
 */
export function parseStoredDeliveryAddress(address: string): {
  street: string;
  houseNumber: string;
} {
  const trimmed = address.trim();
  if (!trimmed) return { street: "", houseNumber: "" };

  let rest = trimmed;
  const cityPrefix = `${TEL_AVIV_CITY},`;
  if (rest.startsWith(cityPrefix)) {
    rest = rest.slice(cityPrefix.length).trim();
  }

  let bestStreet = "";
  for (const street of TEL_AVIV_STREETS) {
    if (
      (rest === street || rest.startsWith(`${street} `)) &&
      street.length > bestStreet.length
    ) {
      bestStreet = street;
    }
  }

  if (!bestStreet) {
    return { street: rest, houseNumber: "" };
  }

  return {
    street: bestStreet,
    houseNumber: rest.slice(bestStreet.length).trim(),
  };
}

/** Show stored addresses with a locale-specific city label; storage keeps Tel Aviv. */
export function formatStoredDeliveryAddressDisplay(
  address: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const trimmed = address.trim();
  if (!trimmed) return trimmed;
  const cityDisplay = t(locale, "checkout.city.telAviv");
  if (trimmed === TEL_AVIV_CITY) return cityDisplay;
  const prefix = `${TEL_AVIV_CITY},`;
  if (trimmed.startsWith(prefix)) {
    return `${cityDisplay},${trimmed.slice(prefix.length)}`;
  }
  return trimmed;
}

/** Readable display for order summaries (legacy rows pass through unchanged). */
export function formatOrderDeliveryAddressDisplay(
  order: {
    address: string;
    apartmentOrNotes?: string;
  },
  locale: Locale = DEFAULT_LOCALE,
): string {
  const raw = order.address?.trim();
  const base = raw ? formatStoredDeliveryAddressDisplay(raw, locale) : "";
  const note = order.apartmentOrNotes?.trim();
  if (!base) return note ? t(locale, "address.noteOnly", { note }) : "—";
  if (!note) return base;
  return t(locale, "address.withNote", { address: base, note });
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
