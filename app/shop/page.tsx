import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { ShopCatalogBar } from "@/components/shop/ShopCatalogBar";
import { ShopPlantCard } from "@/components/shop/ShopPlantCard";
import { readCatalogShopCards } from "@/lib/catalogShop";
import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";

export default async function ShopPage() {
  const locale = await getLocale();
  const plants = await readCatalogShopCards();

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="bg-background text-foreground mx-auto min-h-screen w-full max-w-5xl px-6 pt-10 pb-16"
    >
      <ShopCatalogBar locale={locale} />
      <PlantPageHeader knownPartner="" />
      <h1 className="sr-only">{t(locale, "shop.title")}</h1>
      {plants.length === 0 ? (
        <p className="text-body text-neutral-600">{t(locale, "shop.empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3">
          {plants.map((plant) => (
            <li key={plant.id}>
              <ShopPlantCard plant={plant} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
