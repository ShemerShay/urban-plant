import { notFound } from "next/navigation";

import { TrackPosScan } from "@/components/analytics/TrackPosScan";
import { RememberCustomerPath } from "@/components/customer/RememberCustomerPath";
import { FixedBottomCTA } from "@/components/plant/FixedBottomCTA";
import { PlantPageContactLink } from "@/components/plant/PlantPageContactLink";
import { PlantHero } from "@/components/plant/PlantHero";
import { PlantImageGallery } from "@/components/plant/PlantImageGallery";
import { PlantInventoryBadge } from "@/components/plant/PlantInventoryBadge";
import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { PlantProductAbout } from "@/components/plant/PlantProductAbout";
import { PlantProductInfoGrid } from "@/components/plant/PlantProductInfoGrid";
import { productPageCtaDisplay } from "@/lib/displayLabels";
import { getLocale } from "@/lib/getLocale";
import { inventoryTypeOrDefault } from "@/lib/inventoryType";
import { t } from "@/lib/messages";
import { formatBuyCta } from "@/lib/mockPlants";
import { localizedPlantText } from "@/lib/plantDisplay";
import { getPosLandingDetails } from "@/lib/posLandingRead";
import { getPosSpotForCustomerPurchase } from "@/lib/purchaseEligibility";
import { shouldShowHeldForPaymentProductMessage } from "@/lib/posSpotHold";
import { posSpotCheckoutPath } from "@/lib/routes";

/** Neutral-600 (~4.7:1 on page background) — WCAG AA for small text */
const LANDING_CARE_CLASS = "text-neutral-600";

/**
 * Original POS plant product screen. `/pos/{slug}` redirects to checkout;
 * keep this implementation for a future catalog route.
 */
export async function PosPlantLanding({ spotSlug }: { spotSlug: string }) {
  const locale = await getLocale();

  const resolved = await getPosSpotForCustomerPurchase(spotSlug);
  if (!resolved) notFound();
  const { posSpot, purchaseEnabled } = resolved;

  const { offer, plant, partner: knownPartner, pocket } = await getPosLandingDetails(posSpot);
  if (!offer || offer.status !== "active") notFound();
  if (!plant) notFound();
  if (!plant.light || !plant.difficulty || !plant.images?.length) notFound();

  const partnerName = knownPartner?.name?.trim() ?? "";
  const displayName = localizedPlantText(locale, plant.name, plant.nameHe);
  const displaySubtitle = localizedPlantText(locale, plant.subtitle, plant.subtitleHe);
  const displayDescription = localizedPlantText(
    locale,
    plant.description,
    plant.descriptionHe,
  );
  const displayWater = localizedPlantText(locale, plant.water, plant.waterHe);
  const availableCtaText = formatBuyCta(offer.consumerPrice, plant.currency, locale);
  const ctaText = productPageCtaDisplay(locale, posSpot.status, availableCtaText);
  const heldMessage = shouldShowHeldForPaymentProductMessage(posSpot.status)
    ? t(locale, "plant.held.product")
    : undefined;
  const whatsAppMessage = partnerName
    ? t(locale, "plant.whatsapp.withPartner", {
        plantName: displayName,
        partnerName,
      })
    : t(locale, "plant.whatsapp.withoutPartner", { plantName: displayName });

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-page="plant-page"
      className={`bg-background text-foreground mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pt-10 ${
        heldMessage
          ? "pb-[calc(9.5rem+env(safe-area-inset-bottom))]"
          : "pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
      }`}
    >
      <TrackPosScan
        pos_spot_id={posSpot.id}
        spot_slug={posSpot.spotSlug}
        plant_id={plant.id}
        plant_name={plant.name}
        inventory_type={inventoryTypeOrDefault(plant.inventoryType)}
        offer_id={offer.id}
        partner_id={posSpot.partnerLocationId}
        partner_name={partnerName || undefined}
        pocket_id={posSpot.pocketId}
        pocket_name={pocket?.name}
      />
      <RememberCustomerPath />
      <PlantPageHeader knownPartner={knownPartner?.name ?? ""} />

      <div className="flex flex-1 flex-col items-center text-center">
        <div className="relative flex w-full flex-col">
          <PlantImageGallery images={plant.images} name={displayName} />
          <div className="flex items-center gap-2">
            <div className="absolute top-5 left-5">
              <PlantInventoryBadge status={posSpot.status} />
            </div>
          </div>
        </div>

        <div className="mt-10 w-full">
          <PlantHero locale={locale} name={displayName} subtitle={displaySubtitle} />
        </div>

        <p
          className={`text-heading-sm mt-10 w-full font-semibold leading-snug text-foreground ${
            locale === "he" ? "" : "tracking-[0.02em]"
          }`}
        >
          <span className="block">{t(locale, "plant.marketing.line1")}</span>
          <span className="mt-0.5 block whitespace-nowrap">
            {t(locale, "plant.marketing.line2")}
          </span>
        </p>

        <div className="mt-12 w-full">
          <PlantProductInfoGrid
            light={plant.light}
            water={displayWater}
            difficulty={plant.difficulty}
            averageSize={plant.averageSize}
          />
        </div>

        <div className="mt-14 w-full">
          <PlantProductAbout description={displayDescription} />
        </div>

        <div
          className="mx-auto mt-12 w-full max-w-[20rem] space-y-2 rounded-2xl bg-background px-5 py-4 ring-1 ring-brand-muted/40 sm:max-w-[22rem] sm:px-6 sm:py-[1.125rem]"
          role="note"
          aria-label={t(locale, "plant.availability.aria")}
        >
          <div
            className="text-body flex items-center justify-center gap-2.5 font-semibold leading-snug text-foreground"
          >
            <p>{t(locale, "plant.availability.line1")}</p>
          </div>
          <p className="text-caption leading-relaxed text-neutral-600">
            {t(locale, "plant.availability.line2")}
          </p>
        </div>

        <p className={`text-body mt-10 w-full leading-6 ${LANDING_CARE_CLASS}`}>
          {t(locale, "plant.careReassurance")}
        </p>
      </div>

      <PlantPageContactLink whatsAppMessage={whatsAppMessage} />

      <FixedBottomCTA
        href={posSpotCheckoutPath(posSpot.spotSlug)}
        ctaText={ctaText}
        purchaseEnabled={purchaseEnabled}
        messageBelow={heldMessage}
      />
    </main>
  );
}
