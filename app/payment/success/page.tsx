import { CustomerDeadEnd } from "@/components/customer/CustomerDeadEnd";

export default function PaymentSuccessPage() {
  return (
    <CustomerDeadEnd
      title="Payment successful"
      description="Your order was received successfully."
      whatsAppMessage="Hi Urban Plant — I completed a payment and have a question about my order."
      returnLabel="Return to previous page"
    />
  );
}
