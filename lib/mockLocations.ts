import {
  getPartnerLocationById,
  readPartnerLocations,
  type PartnerLocation,
} from "@/lib/partnerLocationStorage";

export type { PartnerLocation };
export { readPartnerLocations };

export async function getLocationById(id: string): Promise<PartnerLocation | undefined> {
  return getPartnerLocationById(id);
}

/**
 * Normalize QR `location` query into persisted fields.
 * Unknown ids keep raw locationId; name/address stay null for admin “Unknown location”.
 */
export async function resolveLocationFields(locationIdInput: string | null | undefined): Promise<{
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
}> {
  if (locationIdInput == null || typeof locationIdInput !== "string") {
    return { locationId: null, locationName: null, locationAddress: null };
  }
  const trimmed = locationIdInput.trim();
  if (!trimmed) {
    return { locationId: null, locationName: null, locationAddress: null };
  }

  const found = await getPartnerLocationById(trimmed);
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
