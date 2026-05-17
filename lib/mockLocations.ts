export interface PartnerLocation {
  id: string;
  name: string;
  address: string;
  type: string;
  partnerType: string;
  createdAt?: string;
}

/** Pilot / QR partner locations (prototype data). */
export const locations: PartnerLocation[] = [
  {
    id: "cafe-noir",
    name: "Cafe Noir",
    address: "Tel Aviv",
    type: "Cafe",
    partnerType: "Cafe",
  },
  {
    id: "chachos-shenkin",
    name: "Chachos",
    address: "Shenkin, Tel Aviv",
    type: "Cafe",
    partnerType: "Cafe",
  },
  {
    id: "cafe-lev-haair",
    name: "Café Lev HaIr",
    address: "Lev HaIr, Tel Aviv",
    type: "Cafe",
    partnerType: "Cafe",
  },
  {
    id: "partner-01",
    name: "Partner 01",
    address: "Tel Aviv",
    type: "Pilot Location",
    partnerType: "Pilot Location",
  },
];

export function getLocationById(id: string): PartnerLocation | undefined {
  return locations.find((loc) => loc.id === id);
}

/**
 * Normalize QR `location` query into persisted fields.
 * Unknown ids keep raw locationId; name/address stay null for admin “Unknown location”.
 */
export function resolveLocationFields(locationIdInput: string | null | undefined): {
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
} {
  if (locationIdInput == null || typeof locationIdInput !== "string") {
    return { locationId: null, locationName: null, locationAddress: null };
  }
  const trimmed = locationIdInput.trim();
  if (!trimmed) {
    return { locationId: null, locationName: null, locationAddress: null };
  }

  const found = getLocationById(trimmed);
  if (found) {
    return {
      locationId: found.id,
      locationName: found.name,
      locationAddress: found.address,
    };
  }

  return {
    locationId: trimmed,
    locationName: null,
    locationAddress: null,
  };
}
