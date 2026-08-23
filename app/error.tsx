"use client";

import { CustomerDeadEnd } from "@/components/customer/CustomerDeadEnd";
import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void reset;
  const locale = useLocale();
  return (
    <CustomerDeadEnd
      title={t(locale, "error.title")}
      description={t(locale, "error.body")}
      whatsAppMessage={t(locale, "recovery.whatsapp.default")}
    />
  );
}
