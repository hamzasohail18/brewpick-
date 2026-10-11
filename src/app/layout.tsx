import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { DEFAULT_LOCALE, dirFor, getT } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const t = getT();

export const metadata: Metadata = {
  title: t("app.name"),
  description: "Compare coffee places in Lahore by effective price, distance and calories.",
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
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
