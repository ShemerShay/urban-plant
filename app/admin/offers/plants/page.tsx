import { AdminOffersManager } from "@/components/admin/AdminOffersManager";
import { enrichOffersWithProduct } from "@/lib/offerEnrichment";
import { readOffers } from "@/lib/offerStorage";
import { readPartnerLocations } from "@/lib/partnerLocationStorage";
import { readPlants } from "@/lib/plantStorage";
import { plantsToWire } from "@/lib/plantWire";
import { readSellableVariantChoices } from "@/lib/sellableVariantStorage";

export default async function AdminOffersPlantsPage() {
  const [offersRaw, plants, variants, locations] = await Promise.all([
    readOffers({ inventoryType: "plants" }),
    readPlants({ inventoryType: "plants" }),
    readSellableVariantChoices(),
    readPartnerLocations(),
  ]);
  const offers = await enrichOffersWithProduct(offersRaw);

  return (
    <main
      id="admin-offers-plants-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <AdminOffersManager
        inventoryType="plants"
        initialOffers={offers}
        initialPlants={plantsToWire(plants)}
        initialVariants={variants}
        initialLocations={locations.map((location) => ({
          id: location.id,
          name: location.name,
        }))}
      />
    </main>
  );
}
