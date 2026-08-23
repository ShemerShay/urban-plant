import { AdminPlantsManager } from "@/components/admin/AdminPlantsManager";

export default function AdminProductsFlowersPage() {
  return (
    <main
      id="admin-products-flowers-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <AdminPlantsManager inventoryType="flowers" />
    </main>
  );
}
