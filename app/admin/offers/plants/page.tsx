import { AdminOffersManager } from "@/components/admin/AdminOffersManager";

export default function AdminOffersPlantsPage() {
  return (
    <main
      id="admin-offers-plants-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <AdminOffersManager inventoryType="plants" />
    </main>
  );
}
