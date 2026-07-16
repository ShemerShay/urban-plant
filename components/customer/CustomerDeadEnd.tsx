import { CustomerRecoveryActions } from "@/components/customer/CustomerRecoveryActions";

interface CustomerDeadEndProps {
  title: string;
  description: string;
  whatsAppMessage?: string;
  preferredReturnHref?: string | null;
  returnLabel?: string;
}

/** Shared customer-facing dead-end layout (404, payment stubs, missing resources). */
export function CustomerDeadEnd({
  title,
  description,
  whatsAppMessage,
  preferredReturnHref,
  returnLabel,
}: CustomerDeadEndProps) {
  return (
    <main
      id="customer-dead-end"
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-10"
    >
      <div className="flex-1 space-y-6">
        <section className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <p className="font-serif-display text-xl font-medium tracking-tight text-neutral-900">
            UrbanPlant
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-emerald-950">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
        </section>
      </div>

      <CustomerRecoveryActions
        whatsAppMessage={whatsAppMessage}
        preferredReturnHref={preferredReturnHref}
        returnLabel={returnLabel}
      />
    </main>
  );
}
