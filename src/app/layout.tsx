import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/app/service-worker";
import { SiteFooter } from "@/components/site-footer";
import { DEFAULT_LOCALE, dirFor, getT } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
// Mono is only used for codes in admin screens: don't preload it on every page.
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], preload: false });

const t = getT();

export const metadata: Metadata = {
  title: t("app.name"),
  description: "Compare coffee places in Lahore by effective price, distance and calories.",
  appleWebApp: { capable: true, title: "BrewPick", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7f1" },
    { media: "(prefers-color-scheme: dark)", color: "#1f1813" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={DEFAULT_LOCALE} dir={dirFor(DEFAULT_LOCALE)}>
      <body className={`${geistSans.variable} ${geistMono.variable} flex min-h-dvh flex-col antialiased`}>
        <a
          href="#main"
          className="sr-only rounded-md bg-background px-4 py-3 text-sm font-medium shadow-lg focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50"
        >
          {t("a11y.skipToContent")}
        </a>
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
