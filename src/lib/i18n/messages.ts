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
  "nav.label": "Main",
  "nav.home": "Home",
  "nav.explore": "Explore",
  "nav.compare": "Compare",
  "nav.deals": "Deals",
  "nav.profile": "Profile",
  "badge.sample": "Sample data",
  "badge.sampleHint": "Fictional placeholder data for testing. Not a real cafe, price or deal.",
  "confidence.verified": "Verified",
  "confidence.community_reported": "Community-reported",
  "confidence.estimated": "Estimated",
  "explore.title": "Explore",
  "explore.search": "Search cafes or areas",
  "explore.filters": "Filters",
  "explore.list": "List",
  "explore.map": "Map",
  "explore.sort": "Sort",
  "explore.clearAll": "Clear all",
  "explore.done": "Done",
  "explore.empty": "No places match these filters.",
  "explore.noPrices": "No prices yet",
  "explore.location.near": "Near you",
  "explore.location.set": "Set location",
  "explore.location.title": "Where are you?",
  "explore.location.useGps": "Use my location",
  "explore.location.orArea": "Or pick an area",
  "explore.location.private": "Your location stays on this phone. It's only used to work out distances.",
  "place.menu": "Menu",
  "place.deals": "Deals",
  "place.hours": "Opening hours",
  "place.beans": "Beans",
  "place.directions": "Directions",
  "place.notFound": "We couldn't find that place.",
  "comingSoon": "Coming soon",
} as const;

export type MessageKey = keyof typeof en;

export const ur: Partial<Record<MessageKey, string>> = {
  "app.name": "بریو پک لاہور",
  "footer.disclaimer": "قیمتیں اور ڈیلز بدل سکتی ہیں؛ کیفے سے تصدیق کر لیں۔",
  "nav.home": "ہوم",
  "nav.explore": "تلاش",
  "nav.compare": "موازنہ",
  "nav.deals": "ڈیلز",
  "nav.profile": "پروفائل",
  "badge.sample": "نمونہ ڈیٹا",
};

export const LOCALES = { en: { dir: "ltr" }, ur: { dir: "rtl" } } as const;
export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = "en";
