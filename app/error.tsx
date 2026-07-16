"use client";

import { CustomerDeadEnd } from "@/components/customer/CustomerDeadEnd";
import { CUSTOMER_RECOVERY_WHATSAPP_MESSAGE } from "@/lib/customerRecovery";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void reset;
  return (
    <CustomerDeadEnd
      title="Something went wrong"
      description="We couldn’t load this page. You can go back if you were viewing a plant, or message us on WhatsApp."
      whatsAppMessage={CUSTOMER_RECOVERY_WHATSAPP_MESSAGE}
    />
  );
}
