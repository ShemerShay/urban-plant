import { AdminOffersManager } from "@/components/admin/AdminOffersManager";

export default function AdminOffersFlowersPage() {
  return (
    <main
      id="admin-offers-flowers-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <AdminOffersManager inventoryType="flowers" />
    </main>
  );
}
