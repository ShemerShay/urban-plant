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
      id="main-content"
      tabIndex={-1}
      data-page="customer-dead-end"
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-10"
    >
      <div className="flex-1 space-y-6">
        <section
          className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
          aria-labelledby="customer-dead-end-title"
        >
          <p className="font-display text-heading-sm font-medium tracking-tight text-foreground">
            UrbanPlant
          </p>
          <h1
            id="customer-dead-end-title"
            className="text-display mt-3 font-semibold text-foreground"
          >
            {title}
          </h1>
          <p className="text-body mt-3 leading-6 text-slate-600">{description}</p>
          <CustomerRecoveryActions
            className="mt-6"
            whatsAppMessage={whatsAppMessage}
            preferredReturnHref={preferredReturnHref}
            returnLabel={returnLabel}
          />
        </section>
      </div>
    </main>
  );
}
