import Link from "next/link";

import { parseOrderIdQueryParam } from "@/lib/cardcomPaymentStatus";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import { isPaymentResumeTokenShape } from "@/lib/paymentResumeToken";
import { routes } from "@/lib/routes";

export function ShopPaymentReturnNotice({
  locale,
  paymentFailed,
  orderId,
  resume,
}: {
  locale: Locale;
  paymentFailed: string | null;
  orderId: string | null;
  resume: string | null;
}) {
  if (paymentFailed !== "1" && paymentFailed !== "true") return null;
  const params = new URLSearchParams({ paymentFailed: "1" });
  const validOrderId = parseOrderIdQueryParam(orderId);
  if (validOrderId && resume && isPaymentResumeTokenShape(resume)) {
    params.set("orderId", validOrderId);
    params.set("resume", resume.trim());
  }
  return (
    <p className="text-body mb-6 rounded-[28px] bg-white px-5 py-4 text-neutral-700 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      {t(locale, "shop.paymentReturn")}{" "}
      <Link
        href={`${routes.shop.checkout()}?${params.toString()}`}
        className="font-medium text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55"
      >
        {t(locale, "shop.continuePayment")}
      </Link>
    </p>
  );
}
