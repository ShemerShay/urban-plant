import { CustomerDeadEnd } from "@/components/customer/CustomerDeadEnd";
import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";

export default async function NotFound() {
  const locale = await getLocale();
  return (
    <CustomerDeadEnd
      title={t(locale, "notFound.title")}
      description={t(locale, "notFound.body")}
      whatsAppMessage={t(locale, "recovery.whatsapp.default")}
    />
  );
}
