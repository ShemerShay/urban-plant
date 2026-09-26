import { notFound, redirect } from "next/navigation";

import { AdminPartnerBrandHeader } from "@/components/admin/AdminPartnerBrands";
import { AdminPartnersManager } from "@/components/admin/AdminPartnersManager";
import { getPartnerLocationById } from "@/lib/partnerLocationStorage";
import { getPartnerById } from "@/lib/partnerStorage";
import { routes } from "@/lib/routes";

interface PageProps {
  params: Promise<{ partnerId: string }>;
}

export default async function AdminPartnerPage({ params }: PageProps) {
  const { partnerId: rawId } = await params;
  const partnerId = decodeURIComponent(rawId);

  const partner = await getPartnerById(partnerId);
  if (!partner) {
    const location = await getPartnerLocationById(partnerId);
    if (location) redirect(routes.admin.partnerLocation(location.partnerId, location.id));
    notFound();
  }

  return (
    <main id="admin-partner-page" className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12">
      <AdminPartnerBrandHeader initialPartner={partner} />
      <AdminPartnersManager partnerId={partner.id} />
    </main>
  );
}
