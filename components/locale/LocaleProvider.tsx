"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { t, type MessageKey, type MessageVars } from "@/lib/messages";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useLocale();
  return useCallback(
    (key: MessageKey, vars?: MessageVars) => t(locale, key, vars),
    [locale],
  );
}
