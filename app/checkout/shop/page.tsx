import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { ShopCatalogBar } from "@/components/shop/ShopCatalogBar";
import { ShopCheckout } from "@/components/shop/ShopCheckout";
import { parseOrderIdQueryParam } from "@/lib/cardcomPaymentStatus";
import type { CatalogCheckoutResume } from "@/lib/catalogCheckoutFlow";
import { getLocale } from "@/lib/getLocale";
import { getAwaitingPaymentAttemptForResume } from "@/lib/paymentAttemptStorage";
import type { SavedPaymentAttempt } from "@/lib/paymentAttemptTypes";
import { isPaymentResumeTokenShape } from "@/lib/paymentResumeToken";

interface ShopCheckoutPageProps {
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

function catalogResume(
  attempt: SavedPaymentAttempt,
  resumeToken: string,
  showPaymentFailed: boolean,
): CatalogCheckoutResume | null {
  if (attempt.channel !== "catalog" || !attempt.catalogSnapshot) return null;
  const lines = attempt.catalogSnapshot.lines;
  const first = lines[0];
  if (!first) return null;
  return {
    orderId: attempt.id,
    resumeToken,
    showPaymentFailed,
    fullName: attempt.fullName,
    phone: attempt.phone,
    email: attempt.customerEmail,
    address: attempt.address,
    apartmentOrNotes: attempt.apartmentOrNotes,
    amount: attempt.amount,
    currency: first.currency,
    lines: lines.map((line) => ({
      key: String(line.lineNo),
      name: line.plantName,
      nameHe: line.plantNameHe,
      sizeLabel: line.sizeLabel,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      potName: line.potName,
      potSizeLabel: line.potSizeLabel,
      potColor: line.potColor,
      lineTotal: line.lineTotal,
      currency: line.currency,
    })),
  };
}

export default async function ShopCheckoutPage({ searchParams }: ShopCheckoutPageProps) {
  const locale = await getLocale();
  const sp = await searchParams;
  const paymentFailedFlag =
    readParam(sp.paymentFailed) === "1" || readParam(sp.paymentFailed) === "true";
  const orderId = parseOrderIdQueryParam(readParam(sp.orderId));
  const resumeToken = readParam(sp.resume);
  let resume: CatalogCheckoutResume | null = null;
  if (orderId && resumeToken && isPaymentResumeTokenShape(resumeToken)) {
    const attempt = await getAwaitingPaymentAttemptForResume(orderId, resumeToken);
    if (attempt) resume = catalogResume(attempt, resumeToken, paymentFailedFlag);
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-page="shop-checkout"
      className="bg-background text-foreground mx-auto min-h-screen w-full max-w-5xl px-6 pt-10 pb-16"
    >
      <PlantPageHeader knownPartner="" />
      <ShopCatalogBar locale={locale} showBack />
      <ShopCheckout resume={resume} paymentFailed={paymentFailedFlag && resume == null} />
    </main>
  );
}
