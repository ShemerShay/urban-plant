import { AdminPlantsManager } from "@/components/admin/AdminPlantsManager";

export default function AdminInventoryTypesFlowersPage() {
  return (
    <main
      id="admin-inventory-types-flowers-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <AdminPlantsManager inventoryType="flowers" />
    </main>
  );
}
