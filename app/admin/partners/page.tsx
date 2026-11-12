import { AdminPartnerBrandsManager } from "@/components/admin/AdminPartnerBrands";
import { readPartnerLocations } from "@/lib/partnerLocationStorage";
import { readPartners } from "@/lib/partnerStorage";

export default async function AdminPartnersPage() {
  const [partners, locations] = await Promise.all([readPartners(), readPartnerLocations()]);
  return (
    <main
      id="admin-partners-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <AdminPartnerBrandsManager initialPartners={partners} initialLocations={locations} />
    </main>
  );
}
