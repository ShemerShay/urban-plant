import { redirect } from "next/navigation";

import { getPosSpotById } from "@/lib/posSpotStorage";
import { routes } from "@/lib/routes";

interface PageProps {
  params: Promise<{ posSpotId: string }>;
}

/** Legacy edit URL — send admins to the partner detail page. */
export default async function AdminPosSpotEditRedirectPage({ params }: PageProps) {
  const { posSpotId: rawId } = await params;
  const posSpotId = decodeURIComponent(rawId);
  const spot = await getPosSpotById(posSpotId);
  if (spot?.partnerLocationId) {
    redirect(routes.admin.partner(spot.partnerLocationId));
  }
  redirect(routes.admin.partners());
}
