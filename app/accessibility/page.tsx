import type { Metadata } from "next";

import {
  PUBLIC_CONTACT_EMAIL,
  PUBLIC_WHATSAPP_DISPLAY,
} from "@/lib/publicContact";
import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";
import { buildWhatsAppChatUrl } from "@/lib/whatsappContact";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: t(locale, "a11y.meta.title"),
    description: t(locale, "a11y.meta.description"),
  };
}

export default async function AccessibilityPage() {
  const locale = await getLocale();
  const whatsAppHref = buildWhatsAppChatUrl(t(locale, "a11y.whatsapp"));

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
        <h1 className="text-3xl font-semibold text-emerald-950">{t(locale, "a11y.title")}</h1>

        <section className="space-y-4 text-sm leading-6 text-slate-700" aria-labelledby="a11y-commitment">
          <h2 id="a11y-commitment" className="text-lg font-semibold text-emerald-950">
            {t(locale, "a11y.commitment.title")}
          </h2>
          <p>{t(locale, "a11y.commitment.p1")}</p>
          <p>{t(locale, "a11y.commitment.p2")}</p>
        </section>

        <section className="space-y-4 text-sm leading-6 text-slate-700" aria-labelledby="a11y-contact">
          <h2 id="a11y-contact" className="text-lg font-semibold text-emerald-950">
            {t(locale, "a11y.contact.title")}
          </h2>
          <p>{t(locale, "a11y.contact.body")}</p>
          <ul className="list-disc space-y-2 ps-5">
            <li>
              {t(locale, "a11y.contact.email")}{" "}
              <a
                href={`mailto:${PUBLIC_CONTACT_EMAIL}?subject=${encodeURIComponent(t(locale, "a11y.emailSubject"))}`}
                className="font-medium text-emerald-800 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/50 focus-visible:ring-offset-2"
              >
                {PUBLIC_CONTACT_EMAIL}
              </a>
            </li>
            {whatsAppHref ? (
              <li>
                {t(locale, "a11y.contact.whatsapp")}{" "}
                <a
                  href={whatsAppHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-emerald-800 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/50 focus-visible:ring-offset-2"
                >
                  {PUBLIC_WHATSAPP_DISPLAY}
                  <span className="sr-only">{t(locale, "common.opensNewTab")}</span>
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    </main>
  );
}
