import { notFound } from "next/navigation";

import { FixedBottomCTA } from "@/components/plant/FixedBottomCTA";
import { PlantPageContactLink } from "@/components/plant/PlantPageContactLink";
import { PlantHero } from "@/components/plant/PlantHero";
import { PlantImageGallery } from "@/components/plant/PlantImageGallery";
import { PlantInventoryBadge } from "@/components/plant/PlantInventoryBadge";
import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { PlantProductAbout } from "@/components/plant/PlantProductAbout";
import { PlantProductInfoGrid } from "@/components/plant/PlantProductInfoGrid";
import { getLocationById } from "@/lib/mockLocations";
import { formatBuyCta, getPlantById } from "@/lib/mockPlants";
import { getOfferById } from "@/lib/offerStorage";
import { getPosSpotBySpotSlug } from "@/lib/posSpotStorage";
import { canPurchasePosSpot } from "@/lib/purchaseEligibility";
import { posSpotCheckoutPath } from "@/lib/qrNavigation";

interface PosPageProps {
  params: Promise<{ spotSlug: string }>;
}

export default async function PosPage({ params }: PosPageProps) {
  const { spotSlug } = await params;
  const posSpot = await getPosSpotBySpotSlug(spotSlug);
  if (!posSpot) notFound();

  const offer = await getOfferById(posSpot.currentOfferId);
  if (!offer || offer.status !== "active") notFound();

  const plant = getPlantById(offer.productId);
  if (!plant) notFound();

  const knownPartner = await getLocationById(posSpot.partnerLocationId);
  const ctaText = formatBuyCta(offer.consumerPrice, plant.currency);
  const purchaseEnabled = plant.status !== "sold" && (await canPurchasePosSpot(posSpot.spotSlug));

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
            <div className="absolute top-5 left-5">
              <PlantInventoryBadge spotSlug={posSpot.spotSlug} />
            </div>
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
        href={posSpotCheckoutPath(posSpot.spotSlug)}
        ctaText={ctaText}
        purchaseEnabled={purchaseEnabled}
      />
    </main>
  );
}
