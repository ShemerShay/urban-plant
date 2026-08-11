import {
  PUBLIC_CONTACT_EMAIL,
  PUBLIC_WHATSAPP_DISPLAY,
} from "@/lib/publicContact";
import { buildWhatsAppChatUrl } from "@/lib/whatsappContact";

export const metadata = {
  title: "Accessibility | Urban Plant",
  description: "Accessibility commitment and contact for Urban Plant",
};

export default function AccessibilityPage() {
  const whatsAppHref = buildWhatsAppChatUrl(
    "Hi Urban Plant — I have an accessibility question or barrier to report.",
  );

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-10"
    >
      <div className="flex-1 space-y-6">
        <p className="font-serif-display text-xl font-medium tracking-tight text-neutral-900">
          UrbanPlant
        </p>
        <h1 className="text-3xl font-semibold text-emerald-950">Accessibility</h1>

        <section className="space-y-4 text-sm leading-6 text-slate-700" aria-labelledby="a11y-commitment">
          <h2 id="a11y-commitment" className="text-lg font-semibold text-emerald-950">
            Our commitment
          </h2>
          <p>
            Urban Plant aims to make this website accessible so customers can browse plants,
            check out, and complete payment using assistive technologies and keyboard-only
            navigation.
          </p>
          <p>
            We use the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA as our practical
            accessibility target. We continue to improve the experience and do not claim full
            legal certification or complete conformance for every page at all times.
          </p>
        </section>

        <section className="space-y-4 text-sm leading-6 text-slate-700" aria-labelledby="a11y-contact">
          <h2 id="a11y-contact" className="text-lg font-semibold text-emerald-950">
            Report an accessibility problem
          </h2>
          <p>
            If you encounter a barrier or need help using this site, please contact us. Describe
            the page and the problem so we can investigate.
          </p>
          <ul className="list-disc space-y-2 ps-5">
            <li>
              Email:{" "}
              <a
                href={`mailto:${PUBLIC_CONTACT_EMAIL}?subject=${encodeURIComponent("Accessibility feedback")}`}
                className="font-medium text-emerald-800 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/50 focus-visible:ring-offset-2"
              >
                {PUBLIC_CONTACT_EMAIL}
              </a>
            </li>
            {whatsAppHref ? (
              <li>
                WhatsApp:{" "}
                <a
                  href={whatsAppHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-emerald-800 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/50 focus-visible:ring-offset-2"
                >
                  {PUBLIC_WHATSAPP_DISPLAY}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    </main>
  );
}
