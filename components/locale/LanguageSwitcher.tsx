"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";
import { type Locale } from "@/lib/locale";
import { routes } from "@/lib/routes";

/** Visual order is always HE | EN (independent of document dir). */
const SWITCHER_ORDER: Locale[] = ["he", "en"];

const localeButtonClass = (active: boolean) =>
  active
    ? "text-[11px] font-semibold tracking-[0.08em] text-emerald-950"
    : "text-[11px] font-medium tracking-[0.08em] text-slate-400 hover:text-slate-600";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function selectLocale(next: Locale) {
    if (next === locale || busy) return;
    setBusy(true);
    try {
      const res = await fetch(routes.api.locale(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (!res.ok) return;
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={t(locale, "language.label")}
      dir="ltr"
      className="inline-flex items-center gap-1.5"
    >
      {SWITCHER_ORDER.map((code, index) => {
        const active = code === locale;
        const label = code.toUpperCase();
        return (
          <span key={code} className="inline-flex items-center gap-1.5">
            {index > 0 ? (
              <span className="text-[11px] font-medium text-slate-300" aria-hidden>
                |
              </span>
            ) : null}
            <button
              type="button"
              lang={code}
              aria-pressed={active}
              aria-current={active ? "true" : undefined}
              disabled={pending || busy}
              onClick={() => void selectLocale(code)}
              className={`${localeButtonClass(active)} rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55 disabled:opacity-60`}
            >
              {label}
            </button>
          </span>
        );
      })}
    </div>
  );
}
