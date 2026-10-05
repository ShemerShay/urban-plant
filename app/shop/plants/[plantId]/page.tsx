import Link from "next/link";
import { notFound } from "next/navigation";

import { TrackProductView } from "@/components/analytics/TrackProductView";
import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { ShopPlantDetail } from "@/components/shop/ShopPlantDetail";
import { readCatalogShopDetail } from "@/lib/catalogShop";
import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";

interface PageProps {
  params: Promise<{ plantId: string }>;
}

export default async function ShopPlantPage({ params }: PageProps) {
  const { plantId: rawId } = await params;
  const plantId = decodeURIComponent(rawId).trim();
  const locale = await getLocale();
  const plant = await readCatalogShopDetail(plantId);
  if (!plant) notFound();

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 pt-10 pb-16"
    >
      <TrackProductView plant_id={plant.id} plant_name={plant.name} inventory_type="plants" />
      <Link
        href={routes.shop.index()}
        className="text-caption mb-6 font-medium text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55"
      >
        {t(locale, "shop.back")}
      </Link>
      <PlantPageHeader knownPartner="" />
      <ShopPlantDetail plant={plant} locale={locale} />
    </main>
  );
}
