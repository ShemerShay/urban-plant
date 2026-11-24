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
  searchParams: Promise<{ size?: string | string[]; variant?: string | string[] }>;
}

function oneParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function ShopPlantPage({ params, searchParams }: PageProps) {
  const [{ plantId: rawId }, query, locale] = await Promise.all([
    params,
    searchParams,
    getLocale(),
  ]);
  const plantId = decodeURIComponent(rawId).trim();
  const plant = await readCatalogShopDetail(plantId);
  if (!plant) notFound();
  const initialSizeId = oneParam(query.size);
  const initialVariantId = oneParam(query.variant);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 pt-10 pb-16"
    >
      <TrackProductView plant_id={plant.id} plant_name={plant.name} inventory_type="plants" />
      <PlantPageHeader knownPartner="" />
      <ShopCatalogBar locale={locale} showBack />
      <ShopPlantDetail
        key={`${plant.id}:${initialSizeId ?? ""}:${initialVariantId ?? ""}`}
        plant={plant}
        locale={locale}
        initialSizeId={initialSizeId}
        initialVariantId={initialVariantId}
      />
      <PlantPageContactLink
        whatsAppMessage={t(locale, "plant.whatsapp.withoutPartner", {
          plantName: localizedPlantText(locale, plant.name, plant.nameHe),
        })}
      />
    </main>
  );
}
