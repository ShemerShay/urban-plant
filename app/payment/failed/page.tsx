import { redirect } from "next/navigation";

import { CustomerDeadEnd } from "@/components/customer/CustomerDeadEnd";
import { parseOrderIdQueryParam } from "@/lib/cardcomPaymentStatus";
import { getPendingOrderForPaymentResume, getOrderById } from "@/lib/ordersStorage";
import { isPaymentResumeTokenShape } from "@/lib/paymentResume";
import { routes } from "@/lib/routes";

interface PaymentFailedPageProps {
  searchParams: Promise<{
    orderId?: string | string[];
    resume?: string | string[];
  }>;
}

function readParam(raw: string | string[] | undefined): string | null {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return v?.trim() || null;
}

/**
 * Legacy FailedRedirectUrl stub. Cardcom FailedRedirectUrl now targets checkout.
 * If old links include orderId+resume, bounce to the same checkout.
 */
export default async function PaymentFailedPage({ searchParams }: PaymentFailedPageProps) {
  const sp = await searchParams;
  const orderId = parseOrderIdQueryParam(readParam(sp.orderId));
  const resume = readParam(sp.resume);

  if (orderId && isPaymentResumeTokenShape(resume)) {
    const pending = await getPendingOrderForPaymentResume(orderId, resume);
    const order = pending ?? (await getOrderById(orderId));
    const spotSlug = order?.snapshot?.spotSlug?.trim();
    if (spotSlug) {
      redirect(
        routes.customer.checkoutPaymentFailed({
          spotSlug,
          orderId,
          resumeToken: resume,
        }),
      );
    }
  }

  return (
    <CustomerDeadEnd
      title="Payment wasn’t completed"
      description="התשלום נכשל. אפשר לחזור לעמוד הצמח ולנסות שוב, או ליצור קשר עם Urban Plant."
      whatsAppMessage={
        orderId
          ? `Hi Urban Plant — my payment didn’t complete for order ${orderId}.`
          : "Hi Urban Plant — my payment didn’t complete and I need help."
      }
      returnLabel="Return to previous page"
    />
  );
}
