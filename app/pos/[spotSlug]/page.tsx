import { notFound, redirect } from "next/navigation";

import { getPosSpotForCustomerPurchase } from "@/lib/purchaseEligibility";
import { posSpotCheckoutPath } from "@/lib/routes";

interface PosPageProps {
  params: Promise<{ spotSlug: string }>;
}

/** QR entry: resolve the POS slug and send the customer to checkout. */
export default async function PosPage({ params }: PosPageProps) {
  const { spotSlug } = await params;
  const resolved = await getPosSpotForCustomerPurchase(spotSlug);
  if (!resolved) notFound();
  redirect(posSpotCheckoutPath(resolved.posSpot.spotSlug));
}
