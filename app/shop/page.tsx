import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { ShopCatalogBar } from "@/components/shop/ShopCatalogBar";
import { ShopPaymentReturnNotice } from "@/components/shop/ShopPaymentReturnNotice";
import { ShopPlantCard } from "@/components/shop/ShopPlantCard";
import { readCatalogShopCards } from "@/lib/catalogShop";
import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";

interface ShopPageProps {
  searchParams: Promise<{
    paymentFailed?: string | string[];
    orderId?: string | string[];
    resume?: string | string[];
  }>;
}

function readParam(raw: string | string[] | undefined): string | null {
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return value?.trim() || null;
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const locale = await getLocale();
  const plants = await readCatalogShopCards();
  const sp = await searchParams;

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="bg-background text-foreground mx-auto min-h-screen w-full max-w-5xl px-6 pt-10 pb-16"
    >
      <PlantPageHeader knownPartner="" />
      <ShopCatalogBar locale={locale} />
      <ShopPaymentReturnNotice
        locale={locale}
        paymentFailed={readParam(sp.paymentFailed)}
        orderId={readParam(sp.orderId)}
        resume={readParam(sp.resume)}
      />
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
