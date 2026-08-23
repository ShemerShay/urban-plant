import type { Metadata } from "next";
import { Cormorant_Garamond, Geist, Geist_Mono, Noto_Sans_Hebrew } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { LocaleProvider } from "@/components/locale/LocaleProvider";
import { SkipToMainContent } from "@/components/customer/SkipToMainContent";
import { PostHogProvider } from "@/components/PostHogProvider";
import { PostHogPageView } from "@/components/PostHogPageView";
import { getLocale } from "@/lib/getLocale";
import { localeHtmlDir, localeHtmlLang } from "@/lib/locale";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const notoSansHebrew = Noto_Sans_Hebrew({
  variable: "--font-noto-sans-hebrew",
  subsets: ["hebrew"],
});

export const metadata: Metadata = {
  title: "Urban Plant",
  description: "QR-based plant commerce experience",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html
      lang={localeHtmlLang(locale)}
      dir={localeHtmlDir(locale)}
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} ${notoSansHebrew.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col main-layout">
          <LocaleProvider locale={locale}>
            <Suspense fallback={null}>
              <SkipToMainContent />
            </Suspense>
            <PostHogProvider>
              <Suspense fallback={null}>
                <PostHogPageView />
              </Suspense>
              {children}
            </PostHogProvider>
          </LocaleProvider>
        </body>
    </html>
  );
}
