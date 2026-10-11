import type { MetadataRoute } from "next";
import { getT } from "@/lib/i18n";

const t = getT();

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: t("app.name"),
    short_name: "BrewPick",
    description: t("app.tagline"),
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fdf9f4",
    theme_color: "#6f3f22",
    lang: "en",
    dir: "ltr",
    categories: ["food", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pick for me", url: "/pick" },
      { name: "Today's deals", url: "/deals" },
    ],
  };
}
