import { TrackPosScan } from "@/components/analytics/TrackPosScan";
import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import type { AnalyticsCommerceProps } from "@/lib/analyticsEvents";
import { displayApiError } from "@/lib/displayLabels";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";

interface FlowerPaymentStartErrorProps {
  error: string;
  partnerName: string;
  locale: Locale;
  analyticsContext: AnalyticsCommerceProps;
}

/** Minimal flower QR error when Cardcom payment cannot be started. */
export function FlowerPaymentStartError({
  error,
  partnerName,
  locale,
  analyticsContext,
}: FlowerPaymentStartErrorProps) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-page="flower-payment-start-error"
      data-inventory-type="flowers"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6"
    >
      <TrackPosScan {...analyticsContext} />
      <div className="space-y-6">
        <PlantPageHeader knownPartner={partnerName} />
        <section
          className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
          aria-labelledby="flower-payment-start-error-heading"
        >
          <h1
            id="flower-payment-start-error-heading"
            className="text-heading font-semibold text-foreground"
          >
            {t(locale, "checkout.error.generic")}
          </h1>
          <p className="text-body mt-3 leading-6 text-slate-600">
            {displayApiError(locale, error, "checkout.error.generic")}
          </p>
        </section>
      </div>
    </main>
  );
}
