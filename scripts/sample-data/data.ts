// SAMPLE DATA — FICTIONAL. Every place, brand, price, recipe and deal here is invented placeholder
// data for development and demos (Section 9). Names are made up; values are plausible, not real.
// Everything generated from this file is flagged is_sample and shown with a "Sample data" badge.
// Remove it all with `npm run sample:purge` (or the button on /admin/import).

export type PlaceType = "specialty_cafe" | "chain" | "kiosk_drive_thru" | "bakery_cafe";
export type Confidence = "verified" | "community_reported" | "estimated";

export interface SampleSize {
  label: string;
  ml: number;
  shots: number;
  milkMl: number;
  /** Extras on top of espresso + milk, e.g. chocolate sauce. */
  extra?: { what: string; kcal: number; sugarG: number };
  /** Caffeine override (cold brew isn't espresso-based). */
  caffeineMg?: number;
  basePkr: number;
}

export interface SampleDrink {
  slug: string; // drink_types.slug
  name: string;
  temperature: "hot" | "iced";
  ingredients: string[]; // ingredients.name
  sizes: SampleSize[];
}

const choc = (g: number) => ({ what: `${g} g chocolate sauce`, kcal: Math.round(g * 3.6), sugarG: Math.round(g * 0.6) });
const condensed = (ml: number) => ({ what: `${ml} ml condensed milk`, kcal: Math.round(ml * 3.3), sugarG: Math.round(ml * 0.55) });
const frappeBase = (g: number) => ({ what: `${g} g frappe base + whipped cream`, kcal: Math.round(g * 3.9 + 60), sugarG: Math.round(g * 0.65) });

export const DRINKS: SampleDrink[] = [
  {
    slug: "espresso", name: "Espresso", temperature: "hot", ingredients: ["espresso"],
    sizes: [
      { label: "Single", ml: 30, shots: 1, milkMl: 0, basePkr: 420 },
      { label: "Double", ml: 60, shots: 2, milkMl: 0, basePkr: 580 },
    ],
  },
  {
    slug: "americano", name: "Americano", temperature: "hot", ingredients: ["espresso", "water"],
    sizes: [
      { label: "Regular", ml: 350, shots: 2, milkMl: 0, basePkr: 520 },
      { label: "Large", ml: 470, shots: 3, milkMl: 0, basePkr: 640 },
    ],
  },
  {
    slug: "latte", name: "Cafe Latte", temperature: "hot", ingredients: ["espresso", "whole milk", "milk foam"],
    sizes: [
      { label: "Regular", ml: 350, shots: 2, milkMl: 290, basePkr: 720 },
      { label: "Large", ml: 470, shots: 2, milkMl: 400, basePkr: 880 },
    ],
  },
  {
    slug: "cappuccino", name: "Cappuccino", temperature: "hot", ingredients: ["espresso", "whole milk", "milk foam"],
    sizes: [
      { label: "Regular", ml: 350, shots: 2, milkMl: 230, basePkr: 700 },
      { label: "Large", ml: 470, shots: 2, milkMl: 320, basePkr: 850 },
    ],
  },
  {
    slug: "flat-white", name: "Flat White", temperature: "hot", ingredients: ["espresso", "whole milk"],
    sizes: [{ label: "Regular", ml: 240, shots: 2, milkMl: 170, basePkr: 760 }],
  },
  {
    slug: "mocha", name: "Mocha", temperature: "hot", ingredients: ["espresso", "whole milk", "chocolate sauce"],
    sizes: [
      { label: "Regular", ml: 350, shots: 2, milkMl: 260, extra: choc(30), basePkr: 820 },
      { label: "Large", ml: 470, shots: 2, milkMl: 360, extra: choc(40), basePkr: 980 },
    ],
  },
  {
    slug: "spanish-latte", name: "Spanish Latte", temperature: "hot", ingredients: ["espresso", "whole milk", "condensed milk"],
    sizes: [
      { label: "Regular", ml: 350, shots: 2, milkMl: 250, extra: condensed(30), basePkr: 840 },
      { label: "Large", ml: 470, shots: 2, milkMl: 350, extra: condensed(40), basePkr: 990 },
    ],
  },
  {
    slug: "iced-latte", name: "Iced Latte", temperature: "iced", ingredients: ["espresso", "whole milk", "ice"],
    sizes: [
      { label: "Regular", ml: 350, shots: 2, milkMl: 220, basePkr: 780 },
      { label: "Large", ml: 470, shots: 2, milkMl: 300, basePkr: 930 },
    ],
  },
  {
    slug: "cold-brew", name: "Cold Brew", temperature: "iced", ingredients: ["cold brew concentrate", "water", "ice"],
    sizes: [
      { label: "Regular", ml: 350, shots: 0, milkMl: 0, caffeineMg: 190, basePkr: 740 },
      { label: "Large", ml: 470, shots: 0, milkMl: 0, caffeineMg: 255, basePkr: 880 },
    ],
  },
  {
    slug: "frappe", name: "Coffee Frappe", temperature: "iced", ingredients: ["espresso", "whole milk", "frappe base", "ice", "whipped cream"],
    sizes: [
      { label: "Regular", ml: 350, shots: 1, milkMl: 150, extra: frappeBase(60), basePkr: 890 },
      { label: "Large", ml: 470, shots: 1, milkMl: 200, extra: frappeBase(80), basePkr: 1090 },
    ],
  },
];

export interface SampleBeans {
  kind: "single_origin" | "blend";
  origin: string | null;
  region: string | null;
  roast: "light" | "medium_light" | "medium" | "medium_dark" | "dark";
  arabica: number;
  robusta: number;
  notes: string | null;
}

export interface SamplePlace {
  slug: string;
  name: string;
  branch?: string;
  brand?: string; // brand slug
  type: PlaceType;
  area: string; // areas.name
  /** Offset from the area centroid in degrees (lat, lng). */
  offset: [number, number];
  /** Price multiplier vs the base menu. */
  tier: number;
  drinks: string[]; // DRINKS slugs
  milkOptions: ("oat" | "almond" | "lactose_free")[];
  hours: string; // OSM opening_hours syntax
  wifi: boolean | null;
  family: boolean | null;
  halal: boolean | null;
  rating: number;
  ratings: number;
  beans: SampleBeans | null;
  /** How the prices were (fictionally) verified and how long ago, to exercise freshness badges. */
  priceConfidence: Confidence;
  verifiedDaysAgo: number;
}

const ALL = DRINKS.map((d) => d.slug);
const CORE = ["espresso", "americano", "latte", "cappuccino", "mocha", "iced-latte"];

export const BRANDS = [{ slug: "brew-bazaar", name: "Brew Bazaar" }];

export const PLACES: SamplePlace[] = [
  {
    slug: "saffron-steam-coffee", name: "Saffron Steam Coffee", type: "specialty_cafe", area: "Gulberg", offset: [0.0031, -0.0022],
    tier: 1.2, drinks: ALL, milkOptions: ["oat", "almond", "lactose_free"], hours: "Mo-Su 09:00-01:00",
    wifi: true, family: true, halal: true, rating: 4.7, ratings: 318,
    beans: { kind: "single_origin", origin: "Ethiopia", region: "Yirgacheffe", roast: "light", arabica: 100, robusta: 0, notes: "Jasmine, lemon, black tea" },
    priceConfidence: "verified", verifiedDaysAgo: 2,
  },
  {
    slug: "ravi-roast-house", name: "Ravi Roast House", type: "specialty_cafe", area: "DHA", offset: [-0.0042, 0.0035],
    tier: 1.15, drinks: ALL.filter((d) => d !== "frappe"), milkOptions: ["oat", "lactose_free"], hours: "Mo-Th 08:00-23:00; Fr 14:00-01:00; Sa,Su 09:00-01:00",
    wifi: true, family: true, halal: true, rating: 4.6, ratings: 241,
    beans: { kind: "blend", origin: "Brazil, Colombia", region: null, roast: "medium", arabica: 100, robusta: 0, notes: "Chocolate, caramel, hazelnut" },
    priceConfidence: "verified", verifiedDaysAgo: 6,
  },
  {
    slug: "kite-and-cup", name: "Kite & Cup", type: "specialty_cafe", area: "Model Town", offset: [0.0018, 0.0026],
    tier: 1.1, drinks: [...CORE, "flat-white", "cold-brew"], milkOptions: ["oat", "almond"], hours: "Mo-Su 10:00-23:30",
    wifi: true, family: true, halal: null, rating: 4.4, ratings: 133,
    beans: { kind: "single_origin", origin: "Colombia", region: "Huila", roast: "medium_light", arabica: 100, robusta: 0, notes: "Red apple, panela" },
    priceConfidence: "community_reported", verifiedDaysAgo: 12,
  },
  {
    slug: "brew-bazaar-gulberg", name: "Brew Bazaar", branch: "Gulberg", brand: "brew-bazaar", type: "chain", area: "Gulberg", offset: [-0.0035, 0.0041],
    tier: 1.0, drinks: ALL, milkOptions: ["oat", "lactose_free"], hours: "Mo-Su 08:00-02:00",
    wifi: true, family: true, halal: true, rating: 4.1, ratings: 902,
    beans: { kind: "blend", origin: "Brazil, Vietnam", region: null, roast: "medium_dark", arabica: 80, robusta: 20, notes: "Dark chocolate, roasted nuts" },
    priceConfidence: "verified", verifiedDaysAgo: 4,
  },
  {
    slug: "brew-bazaar-johar-town", name: "Brew Bazaar", branch: "Johar Town", brand: "brew-bazaar", type: "chain", area: "Johar Town", offset: [0.0024, -0.0031],
    tier: 1.0, drinks: ALL, milkOptions: ["oat", "lactose_free"], hours: "Mo-Su 08:00-02:00",
    wifi: true, family: true, halal: true, rating: 4.0, ratings: 655,
    beans: { kind: "blend", origin: "Brazil, Vietnam", region: null, roast: "medium_dark", arabica: 80, robusta: 20, notes: "Dark chocolate, roasted nuts" },
    priceConfidence: "verified", verifiedDaysAgo: 4,
  },
  {
    slug: "brew-bazaar-dha", name: "Brew Bazaar", branch: "DHA Phase 5", brand: "brew-bazaar", type: "chain", area: "DHA", offset: [0.0052, -0.0012],
    tier: 1.05, drinks: ALL, milkOptions: ["oat", "lactose_free"], hours: "Mo-Su 08:00-02:00",
    wifi: true, family: true, halal: true, rating: 4.2, ratings: 780,
    beans: { kind: "blend", origin: "Brazil, Vietnam", region: null, roast: "medium_dark", arabica: 80, robusta: 20, notes: "Dark chocolate, roasted nuts" },
    priceConfidence: "community_reported", verifiedDaysAgo: 40,
  },
  {
    slug: "mall-road-mugs", name: "Mall Road Mugs", type: "bakery_cafe", area: "Mall Road", offset: [-0.0015, 0.0019],
    tier: 0.88, drinks: ["americano", "latte", "cappuccino", "mocha", "spanish-latte"], milkOptions: ["lactose_free"], hours: "Mo-Sa 08:00-22:00; Su 10:00-20:00",
    wifi: false, family: true, halal: true, rating: 4.0, ratings: 188, beans: null,
    priceConfidence: "community_reported", verifiedDaysAgo: 20,
  },
  {
    slug: "jasmine-beans", name: "Jasmine Beans", type: "specialty_cafe", area: "Cantt", offset: [0.0026, 0.0014],
    tier: 1.25, drinks: [...CORE, "flat-white", "cold-brew", "spanish-latte"], milkOptions: ["oat", "almond", "lactose_free"], hours: "Tu-Su 11:00-23:00; Mo off",
    wifi: true, family: false, halal: true, rating: 4.8, ratings: 96,
    beans: { kind: "single_origin", origin: "Kenya", region: "Nyeri", roast: "light", arabica: 100, robusta: 0, notes: "Blackcurrant, grapefruit" },
    priceConfidence: "verified", verifiedDaysAgo: 1,
  },
  {
    slug: "quick-cuppa-drive-thru", name: "Quick Cuppa Drive-Thru", type: "kiosk_drive_thru", area: "Johar Town", offset: [-0.0048, 0.0022],
    tier: 0.72, drinks: ["americano", "latte", "cappuccino", "iced-latte", "frappe"], milkOptions: [], hours: "Mo-Su 07:00-03:00",
    wifi: null, family: false, halal: true, rating: 3.9, ratings: 412, beans: null,
    priceConfidence: "community_reported", verifiedDaysAgo: 9,
  },
  {
    slug: "crumb-and-crema", name: "Crumb & Crema", type: "bakery_cafe", area: "Garden Town", offset: [0.0012, -0.0027],
    tier: 0.92, drinks: ["espresso", "americano", "latte", "cappuccino", "spanish-latte", "iced-latte"], milkOptions: ["lactose_free"], hours: "Mo-Su 08:30-22:30",
    wifi: true, family: true, halal: true, rating: 4.3, ratings: 205, beans: null,
    priceConfidence: "estimated", verifiedDaysAgo: 33,
  },
  {
    slug: "bahria-bean-kiosk", name: "Bahria Bean Kiosk", type: "kiosk_drive_thru", area: "Bahria Town", offset: [0.0021, 0.0033],
    tier: 0.75, drinks: ["espresso", "americano", "latte", "iced-latte", "cold-brew"], milkOptions: [], hours: "Mo-Su 08:00-00:00",
    wifi: null, family: false, halal: null, rating: 4.0, ratings: 87, beans: null,
    priceConfidence: "community_reported", verifiedDaysAgo: 15,
  },
  {
    slug: "canal-side-coffee-co", name: "Canal Side Coffee Co.", type: "specialty_cafe", area: "Faisal Town", offset: [-0.0024, -0.0018],
    tier: 1.08, drinks: ALL.filter((d) => d !== "spanish-latte"), milkOptions: ["oat", "lactose_free"], hours: "Mo-Su 10:00-01:00",
    wifi: true, family: true, halal: true, rating: 4.4, ratings: 174,
    beans: { kind: "blend", origin: "Brazil, India", region: null, roast: "medium", arabica: 90, robusta: 10, notes: "Cocoa, dried fig" },
    priceConfidence: "verified", verifiedDaysAgo: 3,
  },
  {
    slug: "lantern-lane-espresso", name: "Lantern Lane Espresso", type: "specialty_cafe", area: "Shadman", offset: [0.0016, -0.0013],
    tier: 1.12, drinks: [...CORE, "flat-white"], milkOptions: ["oat", "almond", "lactose_free"], hours: "Mo-Fr 07:30-22:00; Sa,Su 09:00-23:00",
    wifi: true, family: false, halal: true, rating: 4.5, ratings: 121,
    beans: { kind: "single_origin", origin: "Guatemala", region: "Antigua", roast: "medium", arabica: 100, robusta: 0, notes: "Milk chocolate, orange" },
    priceConfidence: "community_reported", verifiedDaysAgo: 8,
  },
  {
    slug: "valencia-velvet-coffee", name: "Valencia Velvet Coffee", type: "specialty_cafe", area: "Valencia", offset: [-0.0013, 0.0024],
    tier: 0.98, drinks: [...CORE, "spanish-latte", "frappe"], milkOptions: ["lactose_free"], hours: "Mo-Su 12:00-02:00",
    wifi: true, family: true, halal: true, rating: 4.2, ratings: 143,
    beans: { kind: "blend", origin: "Brazil, Uganda", region: null, roast: "medium_dark", arabica: 70, robusta: 30, notes: "Molasses, toasted bread" },
    priceConfidence: "community_reported", verifiedDaysAgo: 52,
  },
];

export interface SampleDeal {
  key: string;
  place?: string; // place slug
  brand?: string; // brand slug
  title: string;
  dealType: "bank_card" | "delivery_app" | "loyalty" | "happy_hour" | "combo" | "student" | "other";
  discount: "percent" | "flat_pkr" | "bogo" | "fixed_price" | "free_item";
  value: number | null;
  cap?: number;
  minSpend?: number;
  /** Days relative to the seed date. */
  fromDays: number;
  toDays: number;
  days?: number[];
  start?: string;
  end?: string;
  cards?: string[]; // payment_methods.name
  items?: string[]; // DRINKS slugs (deal applies only to these)
  conditions?: string[];
  terms: string;
}

export const DEALS: SampleDeal[] = [
  { key: "saffron-alfalah", place: "saffron-steam-coffee", title: "20% off with Bank Alfalah cards", dealType: "bank_card", discount: "percent", value: 20, cap: 300, fromDays: -10, toDays: 80, days: [1, 2, 3, 4], cards: ["Bank Alfalah"], terms: "Mon–Thu, dine-in and takeaway. Max discount Rs. 300 per transaction." },
  { key: "bazaar-hbl", brand: "brew-bazaar", title: "15% off with HBL cards", dealType: "bank_card", discount: "percent", value: 15, cap: 250, fromDays: -20, toDays: 70, cards: ["HBL"], terms: "All Brew Bazaar branches, every day. Max discount Rs. 250." },
  { key: "ravi-meezan", place: "ravi-roast-house", title: "Rs. 150 off on Rs. 800+ with Meezan Bank", dealType: "bank_card", discount: "flat_pkr", value: 150, minSpend: 800, fromDays: -5, toDays: 55, cards: ["Meezan Bank"], terms: "Minimum spend Rs. 800 before tax." },
  { key: "kite-happy-hour", place: "kite-and-cup", title: "Happy hour: 25% off, 3–6 pm weekdays", dealType: "happy_hour", discount: "percent", value: 25, fromDays: -30, toDays: 90, days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00", terms: "Weekdays 3–6 pm, dine-in only.", conditions: ["dine_in_only"] },
  { key: "jasmine-sc", place: "jasmine-beans", title: "30% off with Standard Chartered", dealType: "bank_card", discount: "percent", value: 30, cap: 500, fromDays: -25, toDays: 1, cards: ["Standard Chartered"], terms: "Ends soon. Max discount Rs. 500." },
  { key: "canal-bogo-cold-brew", place: "canal-side-coffee-co", title: "Buy one get one Cold Brew on Fridays", dealType: "combo", discount: "bogo", value: null, fromDays: -14, toDays: 60, days: [5], items: ["cold-brew"], terms: "Fridays only, same size." },
  { key: "lantern-student", place: "lantern-lane-espresso", title: "Student 10% off", dealType: "student", discount: "percent", value: 10, fromDays: -60, toDays: 120, conditions: ["student_id_required"], terms: "Show a valid student ID." },
  { key: "quick-ubl-late", place: "quick-cuppa-drive-thru", title: "Late-night 10% off with UBL", dealType: "bank_card", discount: "percent", value: 10, fromDays: -7, toDays: 45, start: "22:00", end: "03:00", cards: ["UBL"], terms: "10 pm – 3 am." },
  { key: "bazaar-johar-foodpanda", place: "brew-bazaar-johar-town", title: "Rs. 200 off on Foodpanda", dealType: "delivery_app", discount: "flat_pkr", value: 200, minSpend: 1200, fromDays: -3, toDays: 25, cards: ["Foodpanda"], conditions: ["delivery_only"], terms: "Delivery orders over Rs. 1,200 through Foodpanda." },
  { key: "valencia-jazzcash", place: "valencia-velvet-coffee", title: "Rs. 100 off with JazzCash", dealType: "other", discount: "flat_pkr", value: 100, minSpend: 700, fromDays: -2, toDays: 40, cards: ["JazzCash"], terms: "Pay with JazzCash, minimum Rs. 700." },
];

/** Milk swaps: price premium and reference kcal per 100 ml (same values as the milk_types seed). */
export const MILK_SWAPS = {
  oat: { extraPkr: 180, kcalPer100: 48 },
  almond: { extraPkr: 200, kcalPer100: 15 },
  lactose_free: { extraPkr: 120, kcalPer100: 61 },
} as const;
export const WHOLE_MILK_KCAL_PER_100 = 61;
export const MILK_SUGAR_G_PER_100 = 4.8;
export const CAFFEINE_PER_SHOT_MG = 63;
