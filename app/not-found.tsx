import { CustomerDeadEnd } from "@/components/customer/CustomerDeadEnd";
import { CUSTOMER_RECOVERY_WHATSAPP_MESSAGE } from "@/lib/customerRecovery";

export default function NotFound() {
  return (
    <CustomerDeadEnd
      title="This page isn’t available"
      description="The link or QR code you used couldn’t be opened. The plant or offer may have been moved or removed."
      whatsAppMessage={CUSTOMER_RECOVERY_WHATSAPP_MESSAGE}
    />
  );
}
