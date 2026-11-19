import { notFound, redirect } from "next/navigation";

import { AdminPartnerDetail } from "@/components/admin/AdminPartnerDetail";
import { loadAdminPosSpotsForLocation } from "@/lib/adminPosSpotsPayload";
import { getPartnerLocationById } from "@/lib/partnerLocationStorage";
import { getPartnerById } from "@/lib/partnerStorage";
import { readPocketsByPartner } from "@/lib/pocketStorage";
import { routes } from "@/lib/routes";

interface PageProps {
  params: Promise<{ partnerId: string; locationId: string }>;
}

export default async function AdminPartnerLocationPage({ params }: PageProps) {
  const { partnerId: rawPartnerId, locationId: rawLocationId } = await params;
  const partnerId = decodeURIComponent(rawPartnerId);
  const locationId = decodeURIComponent(rawLocationId);

  const location = await getPartnerLocationById(locationId);
  if (!location) notFound();
  if (location.partnerId !== partnerId) {
    redirect(routes.admin.partnerLocation(location.partnerId, location.id));
  }
  const partner = await getPartnerById(location.partnerId);
  if (!partner) notFound();

  const [pockets, spotsPayload] = await Promise.all([
    readPocketsByPartner(location.id),
    loadAdminPosSpotsForLocation(location.id),
  ]);

  return (
    <main
      id="admin-partner-detail-page"
      className="mx-auto min-h-screen w-full max-w-4xl px-4 py-6 pb-12"
    >
      <AdminPartnerDetail
        partnerId={location.id}
        partner={partner}
        initialLocation={location}
        initialPockets={pockets}
        initialPosSpots={spotsPayload.posSpots}
        initialOffers={spotsPayload.offers}
        initialSpotOffers={spotsPayload.spotOffers}
      />
    </main>
  );
}
