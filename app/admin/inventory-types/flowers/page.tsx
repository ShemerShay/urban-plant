import { AdminPlantsManager } from "@/components/admin/AdminPlantsManager";
import { readPlants } from "@/lib/plantStorage";
import { plantsToWire } from "@/lib/plantWire";

export default async function AdminInventoryTypesFlowersPage() {
  const plants = plantsToWire(await readPlants({ inventoryType: "flowers" }));
  return (
    <main
      id="admin-inventory-types-flowers-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <AdminPlantsManager inventoryType="flowers" initialPlants={plants} />
    </main>
  );
}
