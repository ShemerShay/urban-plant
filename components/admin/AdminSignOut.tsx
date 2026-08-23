"use client";

import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";

export function AdminSignOut() {
  const locale = useLocale();
  return (
    <a
      href={routes.api.adminLogout()}
      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition hover:border-red-200 hover:text-red-600"
    >
      {t(locale, "admin.signOut")}
    </a>
  );
}
