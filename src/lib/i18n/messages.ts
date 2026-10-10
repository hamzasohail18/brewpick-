// Message catalogues. English ships now; Urdu keys exist so RTL can be switched on without code changes.
// Add a key to `en` first; `ur` falls back to English for anything not yet translated.

export const en = {
  "app.name": "BrewPick Lahore",
  "app.tagline": "Where should I get coffee right now?",
  "footer.disclaimer": "Prices and deals may change; confirm with the cafe.",
  "footer.dataSources": "Data sources",
  "footer.about": "About & data sources",
  "about.title": "About BrewPick Lahore",
  "about.intro":
    "BrewPick compares coffee places in Lahore by the price you would actually pay, distance and calories. Every price and deal shows where it came from and when it was last checked.",
  "about.confidence.title": "How sure are we?",
  "about.confidence.verified": "Verified: checked in store, published by the cafe, or confirmed by the owner.",
  "about.confidence.community": "Community-reported: sent in by users with proof, reviewed by us.",
  "about.confidence.estimated": "Estimated: calculated from the recipe; the assumptions are shown.",
  "about.confidence.decay": "Anything not re-checked in 30 days drops one level.",
  "about.attributions": "Data sources and attribution",
  "about.corrections": "Run a cafe, or spotted something wrong? Contact us to correct or remove it.",
} as const;

export type MessageKey = keyof typeof en;

export const ur: Partial<Record<MessageKey, string>> = {
  "app.name": "بریو پک لاہور",
  "footer.disclaimer": "قیمتیں اور ڈیلز بدل سکتی ہیں؛ کیفے سے تصدیق کر لیں۔",
};

export const LOCALES = { en: { dir: "ltr" }, ur: { dir: "rtl" } } as const;
export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = "en";
