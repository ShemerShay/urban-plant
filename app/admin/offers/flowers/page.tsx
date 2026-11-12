import { AdminOffersManager } from "@/components/admin/AdminOffersManager";
import { enrichOffersWithProduct } from "@/lib/offerEnrichment";
import { readOffers } from "@/lib/offerStorage";
import { readPlants } from "@/lib/plantStorage";
import { plantsToWire } from "@/lib/plantWire";

export default async function AdminOffersFlowersPage() {
  const [offersRaw, plants] = await Promise.all([
    readOffers({ inventoryType: "flowers" }),
    readPlants({ inventoryType: "flowers" }),
  ]);
  const offers = await enrichOffersWithProduct(offersRaw);

  return (
    <main
      id="admin-offers-flowers-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <AdminOffersManager
        inventoryType="flowers"
        initialOffers={offers}
        initialPlants={plantsToWire(plants)}
      />
    </main>
  );
}
