import { PaymentVerificationClient } from "@/components/payment/PaymentVerificationClient";

interface PaymentSuccessPageProps {
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
 * Cardcom SuccessRedirectUrl landing page — temporary verification only.
 * Final order confirmation is always `/success`.
 * Cancelled → same checkout via resume token (not a standalone failed page).
 */
export default async function PaymentSuccessPage({
  searchParams,
}: PaymentSuccessPageProps) {
  const sp = await searchParams;
  return (
    <PaymentVerificationClient
      orderIdRaw={readParam(sp.orderId)}
      resumeTokenRaw={readParam(sp.resume)}
    />
  );
}
