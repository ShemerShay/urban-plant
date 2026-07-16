import { notFound } from "next/navigation";

import { RememberCustomerPath } from "@/components/customer/RememberCustomerPath";
import { FixedBottomCTA } from "@/components/plant/FixedBottomCTA";
import { PlantPageContactLink } from "@/components/plant/PlantPageContactLink";
import { PlantHero } from "@/components/plant/PlantHero";
import { PlantImageGallery } from "@/components/plant/PlantImageGallery";
import { PlantInventoryBadge } from "@/components/plant/PlantInventoryBadge";
import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { PlantProductAbout } from "@/components/plant/PlantProductAbout";
import { PlantProductInfoGrid } from "@/components/plant/PlantProductInfoGrid";
import { getLocationById } from "@/lib/mockLocations";
import { formatBuyCta } from "@/lib/mockPlants";
import { getPlantById } from "@/lib/plantCatalog";
import { getOfferById } from "@/lib/offerStorage";
import { getPosSpotBySpotSlugEnsuringNextVisit } from "@/lib/posSpotStorage";
import { canPurchasePosSpot } from "@/lib/purchaseEligibility";
import { posSpotCheckoutPath } from "@/lib/routes";

/** Static marketing copy for the QR plant landing page (not from DB). */
const TOP_MARKETING_LINE_1 = "Looks good here.";
const TOP_MARKETING_LINE_2 = "Could look good at yours.";
const AVAILABILITY_LINE_1 = "This exact plant is available now.";
const AVAILABILITY_LINE_2 = "It may not be here tomorrow.";
const CARE_REASSURANCE =
  "We\u2019ll send simple care instructions after purchase.";

/** Near-black / warm grey — stronger than body, not CTA green. */
const LANDING_HEADLINE_CLASS = "text-[#2a302c]";
const LANDING_AVAILABILITY_PRIMARY_CLASS = "text-[#343a36]";
const LANDING_CARE_CLASS = "text-neutral-400";

function IconMegaphoneUnMuted({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Explicit coordinates — "19-6" was parsed as y=-6 and clipped the icon */}
      <path d="M3 11 21 6v12l-18-7v-3z" />
      <path d="M11.5 14v3.5a2.5 2.5 0 0 0 5 0v-1" />
    </svg>
  );
}

interface PosPageProps {
  params: Promise<{ spotSlug: string }>;
}

export default async function PosPage({ params }: PosPageProps) {
  const { spotSlug } = await params;
  const posSpot = await getPosSpotBySpotSlugEnsuringNextVisit(spotSlug);
  if (!posSpot) notFound();

  const offer = await getOfferById(posSpot.currentOfferId);
  if (!offer || offer.status !== "active") notFound();

  const plant = await getPlantById(offer.productId);
  if (!plant) notFound();

  const knownPartner = await getLocationById(posSpot.partnerLocationId);
  const partnerName = knownPartner?.name?.trim() ?? "";
  const ctaText = formatBuyCta(offer.consumerPrice, plant.currency);
  const purchaseEnabled = await canPurchasePosSpot(posSpot.spotSlug);
  const whatsAppMessage = partnerName
    ? `Hi Urban Plant — I have a question about “${plant.name}” at ${partnerName}.`
    : `Hi Urban Plant — I have a question about “${plant.name}”.`;

  return (
    <main
      id="plant-page"
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-10"
    >
      <RememberCustomerPath />
      <PlantPageHeader knownPartner={knownPartner?.name ?? ""} />

      <div className="flex flex-1 flex-col items-center text-center">
        <div className="relative flex w-full flex-col">
          <PlantImageGallery images={plant.images} name={plant.name} />
          <div className="flex items-center gap-2">
            <div className="absolute top-5 left-5">
              <PlantInventoryBadge spotSlug={posSpot.spotSlug} />
            </div>
          </div>
        </div>

        <div className="mt-10 w-full">
          <PlantHero name={plant.name} subtitle={plant.subtitle} />
        </div>

        <p
          className={`mt-10 w-full text-[16px] font-semibold leading-snug tracking-[0.02em] sm:text-[17px] ${LANDING_HEADLINE_CLASS}`}
        >
          <span className="block">{TOP_MARKETING_LINE_1}</span>
          <span className="mt-0.5 block whitespace-nowrap">{TOP_MARKETING_LINE_2}</span>
        </p>

        <div className="mt-12 w-full">
          <PlantProductInfoGrid
            light={plant.light}
            water={plant.water}
            difficulty={plant.difficulty}
            labels={plant.labels}
          />
        </div>

        <div className="mt-14 w-full">
          <PlantProductAbout description={plant.description} />
        </div>

        <div
          className="mx-auto mt-12 w-full max-w-[20rem] space-y-2 rounded-2xl bg-[#f0efe7] px-5 py-4 sm:max-w-[22rem] sm:px-6 sm:py-[1.125rem]"
          role="note"
          aria-label="Availability"
        >
          <div
            className={`flex items-center justify-center gap-2.5 text-[15px] font-semibold leading-snug ${LANDING_AVAILABILITY_PRIMARY_CLASS}`}
          >
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              <IconMegaphoneUnMuted className="size-4 text-[#6b756f]" />
            </span>
            <p>{AVAILABILITY_LINE_1}</p>
          </div>
          <p className="text-[13px] leading-relaxed text-neutral-500">{AVAILABILITY_LINE_2}</p>
        </div>

        <p className={`mt-10 w-full text-[13px] leading-6 ${LANDING_CARE_CLASS}`}>
          {CARE_REASSURANCE}
        </p>
      </div>

      <PlantPageContactLink whatsAppMessage={whatsAppMessage} />

      <FixedBottomCTA
        href={posSpotCheckoutPath(posSpot.spotSlug)}
        ctaText={ctaText}
        purchaseEnabled={purchaseEnabled}
      />
    </main>
  );
}
