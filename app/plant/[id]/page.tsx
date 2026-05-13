import { notFound } from "next/navigation";

import { FixedBottomCTA } from "@/components/plant/FixedBottomCTA";
import { PlantPageContactLink } from "@/components/plant/PlantPageContactLink";
import { PlantHero } from "@/components/plant/PlantHero";
import { PlantImageGallery } from "@/components/plant/PlantImageGallery";
import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { PlantInventoryBadge } from "@/components/plant/PlantInventoryBadge";
import { PlantProductAbout } from "@/components/plant/PlantProductAbout";
import { PlantProductInfoGrid } from "@/components/plant/PlantProductInfoGrid";
import { getLocationById } from "@/lib/mockLocations";
import { formatBuyCta, getPlantById } from "@/lib/mockPlants";
import { canPurchasePlantAtLocation } from "@/lib/purchaseEligibility";
import { checkoutPath } from "@/lib/qrNavigation";

interface PlantPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ location?: string | string[] }>;
}

export default async function PlantPage({ params, searchParams }: PlantPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const rawLoc = sp.location;
  const locationQuery =
    typeof rawLoc === "string" ? rawLoc : Array.isArray(rawLoc) ? rawLoc[0] : undefined;
  const locationForLinks = locationQuery?.trim() || undefined;

  const plant = getPlantById(id);

  if (!plant) notFound();

  const knownPartner =
    locationForLinks !== undefined ? getLocationById(locationForLinks) : undefined;

  const ctaText = formatBuyCta(plant.price, plant.currency);
  const purchaseEnabled = await canPurchasePlantAtLocation(plant.id, locationForLinks);

  return (
    <main
      id="plant-page"
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-10"
    >
      <PlantPageHeader knownPartner={knownPartner?.name ?? ""} />

      <div className="flex flex-1 flex-col gap-10">
        <div className="relative flex flex-col">
          <PlantImageGallery images={plant.images} name={plant.name} />
          <div className="flex items-center gap-2">
            {locationForLinks ? (
              <div className="absolute top-5 left-5">
                <PlantInventoryBadge plantId={plant.id} locationId={locationForLinks} />
              </div>
            ) : null}
          </div>
        </div>

        <PlantHero name={plant.name} subtitle={plant.subtitle} />

        <PlantProductInfoGrid
          light={plant.light}
          water={plant.water}
          difficulty={plant.difficulty}
          labels={plant.labels}
        />

        <PlantProductAbout description={plant.description} />
      </div>

      <PlantPageContactLink
        whatsAppMessage={`Hi Urban Plant — I have a question about “${plant.name}”.`}
      />

      <FixedBottomCTA
        href={checkoutPath(plant.id, locationForLinks)}
        ctaText={ctaText}
        purchaseEnabled={purchaseEnabled}
      />
    </main>
  );
}
