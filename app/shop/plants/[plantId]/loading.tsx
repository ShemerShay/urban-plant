import { ShopSoftSpinner } from "@/components/shop/ShopSoftSpinner";
import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";

export default async function ShopPlantLoading() {
  const locale = await getLocale();
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-6"
      aria-busy="true"
    >
      <ShopSoftSpinner label={t(locale, "common.loading")} />
    </main>
  );
}
