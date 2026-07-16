import { CustomerDeadEnd } from "@/components/customer/CustomerDeadEnd";

export default function PaymentFailedPage() {
  return (
    <CustomerDeadEnd
      title="Payment wasn’t completed"
      description="No worries — you can go back if you were viewing a plant, or message us on WhatsApp."
      whatsAppMessage="Hi Urban Plant — my payment didn’t complete and I need help."
      returnLabel="Return to previous page"
    />
  );
}
