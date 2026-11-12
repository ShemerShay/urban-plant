import { notFound } from "next/navigation";

import { TrackProductView } from "@/components/analytics/TrackProductView";
import { PlantPageContactLink } from "@/components/plant/PlantPageContactLink";
import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { ShopCatalogBar } from "@/components/shop/ShopCatalogBar";
import { ShopPlantDetail } from "@/components/shop/ShopPlantDetail";
import { readCatalogShopDetail } from "@/lib/catalogShop";
import { localizedPlantText } from "@/lib/plantDisplay";
import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";

interface PageProps {
  params: Promise<{ plantId: string }>;
}

export default async function ShopPlantPage({ params }: PageProps) {
  const [{ plantId: rawId }, locale] = await Promise.all([params, getLocale()]);
  const plantId = decodeURIComponent(rawId).trim();
  const plant = await readCatalogShopDetail(plantId);
  if (!plant) notFound();

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 pt-10 pb-16"
    >
      <TrackProductView plant_id={plant.id} plant_name={plant.name} inventory_type="plants" />
      <PlantPageHeader knownPartner="" />
      <ShopCatalogBar locale={locale} showBack />
      <ShopPlantDetail key={plant.id} plant={plant} locale={locale} />
      <PlantPageContactLink
        whatsAppMessage={t(locale, "plant.whatsapp.withoutPartner", {
          plantName: localizedPlantText(locale, plant.name, plant.nameHe),
        })}
      />
    </main>
  );
}
