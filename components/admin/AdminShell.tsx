"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { AdminSignOut } from "@/components/admin/AdminSignOut";
import { LanguageSwitcher } from "@/components/locale/LanguageSwitcher";
import { useLocale } from "@/components/locale/LocaleProvider";
import { ADMIN_NAV_ITEMS, isAdminNavItemActive } from "@/lib/adminNav";
import { t } from "@/lib/messages";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AdminShell({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    firstFocusable?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButton?.focus();
    };
  }, [open]);

  return (
    <div className="min-h-screen">
      <header
        className="fixed inset-x-0 top-0 z-40 border-b border-slate-200/80 bg-[#f9f8f4]/95 backdrop-blur"
        dir="ltr"
      >
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4">
          <button
            ref={menuButtonRef}
            type="button"
            aria-expanded={open}
            aria-controls={drawerId}
            aria-label={t(locale, "admin.nav.open")}
            onClick={() => setOpen(true)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-emerald-950 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55"
          >
            <span aria-hidden className="text-xl leading-none">☰</span>
          </button>
          <Link
            href={ADMIN_NAV_ITEMS[0].href}
            className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55"
          >
            {t(locale, "admin.brand")}
          </Link>
        </div>
      </header>

      <div className="pt-16">{children}</div>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label={t(locale, "admin.nav.close")}
            className="absolute inset-0 bg-slate-950/35"
            onClick={() => setOpen(false)}
          />
          <aside
            ref={drawerRef}
            id={drawerId}
            role="dialog"
            aria-modal="true"
            aria-label={t(locale, "admin.nav.label")}
            className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-[#f9f8f4] p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
                {t(locale, "admin.brand")}
              </p>
              <button
                type="button"
                aria-label={t(locale, "admin.nav.close")}
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-xl text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55"
              >
                <span aria-hidden>×</span>
              </button>
            </div>

            <nav aria-label={t(locale, "admin.nav.label")} className="mt-8">
              <ul className="space-y-2">
                {ADMIN_NAV_ITEMS.map((item) => {
                  const active = isAdminNavItemActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={
                          active
                            ? "block rounded-2xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white"
                            : "block rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white hover:text-emerald-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55"
                        }
                      >
                        {t(locale, item.label)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="mt-auto flex items-center justify-between gap-4 border-t border-slate-200 pt-5">
              <LanguageSwitcher />
              <AdminSignOut />
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
