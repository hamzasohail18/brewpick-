import { describe, expect, test } from "vitest";
import { diffRecord } from "@/lib/pipeline/diff";
import { karachiDate, matchDrinkType, normName, parsePkr, parseSize, parseTime, parseTimeRange } from "@/lib/pipeline/normalize";
import type { PriceRecord } from "@/lib/pipeline/records";
import { caloriesPlausible, validateRecord } from "@/lib/pipeline/validate";

const PLACE = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-10-12T10:00:00+05:00";

describe("normalizer", () => {
  test.each([
    ["Rs. 1,250/-", 1250],
    ["PKR 650", 650],
    ["650.00", 650],
    ["Rs 849.5", 850],
    ["₨ 700", 700],
    [720, 720],
    ["650 - 750", null],
    ["$5", null],
    ["", null],
    ["free", null],
  ])("parsePkr(%j) = %j", (input, expected) => {
    expect(parsePkr(input)).toBe(expected);
  });

  test("sizes: stated volume wins, defaults are flagged as assumed", () => {
    expect(parseSize("12 oz")).toEqual({ size_label: "12 Oz", volume_ml: 355, volume_is_assumed: false });
    expect(parseSize("Large", "16oz")).toEqual({ size_label: "Large", volume_ml: 473, volume_is_assumed: false });
    expect(parseSize("Regular 350ml")).toEqual({ size_label: "Regular", volume_ml: 350, volume_is_assumed: false });
    expect(parseSize("L")).toEqual({ size_label: "Large", volume_ml: 470, volume_is_assumed: true });
    expect(parseSize("small")).toEqual({ size_label: "Small", volume_ml: 240, volume_is_assumed: true });
    expect(parseSize("")).toEqual({ size_label: "Regular", volume_ml: 350, volume_is_assumed: true });
    expect(parseSize("Mug")).toEqual({ size_label: "Mug", volume_ml: null, volume_is_assumed: false });
  });

  const types = [
    { slug: "latte", aliases: ["latte", "cafe latte", "caffe latte"] },
    { slug: "iced-latte", aliases: ["iced latte", "ice latte"] },
    { slug: "spanish-latte", aliases: ["spanish latte"] },
    { slug: "cold-brew", aliases: ["cold brew", "coldbrew"] },
  ];

  test("drink types: exact alias, then longest contained alias", () => {
    expect(matchDrinkType("Caffè Latte", types)).toEqual({ slug: "latte", exact: true });
    expect(matchDrinkType("Hazelnut Iced Latte", types)).toEqual({ slug: "iced-latte", exact: false });
    expect(matchDrinkType("Spanish Latte (Hot)", types)).toEqual({ slug: "spanish-latte", exact: false });
    expect(matchDrinkType("Chai", types)).toBeNull();
    expect(matchDrinkType("Lattes", types)).toBeNull(); // whole words only
  });

  test("times and ranges, including past midnight", () => {
    expect(parseTime("9:30 pm")).toBe("21:30");
    expect(parseTime("12am")).toBe("00:00");
    expect(parseTime("12 PM")).toBe("12:00");
    expect(parseTime("08:00")).toBe("08:00");
    expect(parseTime("9")).toBeNull();
    expect(parseTimeRange("12pm - 2am")).toEqual({ opens: "12:00", closes: "02:00" });
    expect(parseTimeRange("8:00 to 23:30")).toEqual({ opens: "08:00", closes: "23:30" });
  });

  test("helpers", () => {
    expect(normName("  Caffè   Latte! ")).toBe("caffe latte");
    expect(karachiDate(new Date("2026-10-11T20:00:00Z"))).toBe("2026-10-12"); // 01:00 in Lahore
  });
});

function price(overrides: Partial<PriceRecord> = {}): PriceRecord {
  return {
    kind: "item_price",
    place_id: PLACE,
    item: { display_name: "Latte", drink_type_slug: "latte", temperature: "hot", has_milk: true },
    size: { size_label: "Regular", volume_ml: 350, volume_is_assumed: false },
    channel: "dine_in",
    price_pkr: 750,
    tax_inclusive: true,
    source_url: "https://cafe.example.com/menu",
    proof_image_url: null,
    confidence: "community_reported",
    captured_at: NOW,
    ...overrides,
  };
}

describe("validator", () => {
  test("a clean price passes with no flags", () => {
    const v = validateRecord(price());
    expect(v).toMatchObject({ errors: [], flags: [] });
  });

  test("structural problems are errors", () => {
    const v = validateRecord({ kind: "item_price", place_id: "nope" });
    expect(v.record).toBeNull();
    expect(v.errors.join("\n")).toMatch(/place_id/);
  });

  test("missing source URL is rejected unless there is a proof image", () => {
    expect(validateRecord(price({ source_url: null })).errors.join()).toMatch(/source URL/);
    expect(validateRecord(price({ source_url: null, proof_image_url: "https://img.example.com/p.jpg" })).errors).toEqual([]);
  });

  test("prices: hard range rejects, soft range flags", () => {
    expect(validateRecord(price({ price_pkr: 7500 })).errors.join()).toMatch(/outside Rs. 50–5000/);
    expect(validateRecord(price({ price_pkr: 3200 })).flags).toContain("price_out_of_range");
    expect(validateRecord(price({ price_pkr: 90 })).flags).toContain("price_out_of_range");
  });

  test("assumed volume and unknown drink type are flagged", () => {
    const v = validateRecord(price({ size: { size_label: "L", volume_ml: 470, volume_is_assumed: true }, item: { display_name: "Pink Latte?", drink_type_slug: null, temperature: null, has_milk: null } }));
    expect(v.flags).toEqual(expect.arrayContaining(["volume_assumed", "unknown_drink_type"]));
  });

  const nutrition = {
    kind: "nutrition",
    place_id: PLACE,
    item_display_name: "Latte",
    size_label: "Regular",
    volume_ml: 350,
    has_milk: true,
    calories_kcal: 190,
    caffeine_mg: 130,
    assumptions: "2 shots, 300 ml whole milk, no sugar",
    source_url: "https://cafe.example.com/menu",
    confidence: "estimated",
    captured_at: NOW,
  };

  test("estimated nutrition needs assumptions", () => {
    expect(validateRecord({ ...nutrition, assumptions: null }).errors.join()).toMatch(/assumptions/);
    expect(validateRecord(nutrition).errors).toEqual([]);
  });

  test("calories inconsistent with size and milk are flagged", () => {
    expect(validateRecord({ ...nutrition, calories_kcal: 800 }).flags).toContain("calories_implausible"); // kJ typed as kcal
    expect(validateRecord({ ...nutrition, calories_kcal: 15 }).flags).toContain("calories_implausible"); // too low for milk
    expect(caloriesPlausible(10, 350, false).ok).toBe(true); // americano
    expect(caloriesPlausible(400, 470, true).ok).toBe(true); // big mocha
  });

  const deal = {
    kind: "deal",
    place_id: PLACE,
    title: "20% off with Bank Alfalah",
    deal_type: "bank_card",
    discount: "percent",
    discount_value: 20,
    valid_from: "2026-10-01",
    valid_to: "2026-12-31",
    source_url: "https://bank.example.com/offers",
    confidence: "community_reported",
    captured_at: NOW,
  };

  test("deals: end before start is an error; expiring and oversized discounts are flagged", () => {
    expect(validateRecord({ ...deal, valid_to: "2026-09-01" }, { today: "2026-10-12" }).errors.join()).toMatch(/ends .* before it starts/);
    expect(validateRecord({ ...deal, valid_to: "2026-10-13" }, { today: "2026-10-12" }).flags).toContain("deal_expires_soon");
    expect(validateRecord({ ...deal, valid_from: "2026-09-01", valid_to: "2026-10-01" }, { today: "2026-10-12" }).flags).toContain("deal_expired");
    expect(validateRecord({ ...deal, discount_value: 70 }, { today: "2026-10-12" }).flags).toContain("discount_over_50pct");
    expect(validateRecord({ ...deal, start_time: "15:00" }, { today: "2026-10-12" }).errors.join()).toMatch(/start and an end/);
  });
});

describe("diff engine", () => {
  test("no live row is a create", () => {
    expect(diffRecord("item_price", null, price())).toEqual({ action: "create", diff: {}, flags: ["new_item"] });
  });

  test("identical values are a reconfirm", () => {
    const current = { price_pkr: 750, tax_inclusive: true, volume_ml: 350 };
    expect(diffRecord("item_price", current, price()).action).toBe("reconfirm");
  });

  test("source silence is not a change; assumed volume is not a claim", () => {
    const current = { price_pkr: 750, tax_inclusive: true, volume_ml: 330 };
    const r = price({ tax_inclusive: null, size: { size_label: "Regular", volume_ml: 350, volume_is_assumed: true } });
    expect(diffRecord("item_price", current, r).action).toBe("reconfirm");
  });

  test("price changes over 15% are flagged", () => {
    const current = { price_pkr: 600, tax_inclusive: true, volume_ml: 350 };
    const small = diffRecord("item_price", current, price({ price_pkr: 650 }));
    expect(small).toMatchObject({ action: "update", diff: { price_pkr: { from: 600, to: 650 } }, flags: [] });
    expect(diffRecord("item_price", current, price({ price_pkr: 750 })).flags).toEqual(["price_change_over_15pct"]);
  });

  test("coordinates within ~50 m and Postgres-shaped values compare equal", () => {
    const place = {
      kind: "place" as const,
      name: "Sample Cafe",
      branch_name: null,
      type: "specialty_cafe" as const,
      area_id: null,
      address: null,
      lat: 31.5204,
      lng: 74.3587,
      phone: null,
      website_url: null,
      instagram_handle: null,
      osm_id: "node/1",
      google_place_id: null,
      halal_certified: null,
      has_wifi: true,
      has_family_seating: null,
      has_drive_thru: null,
      hours: null,
      source_url: "https://www.openstreetmap.org/node/1",
      proof_image_url: null,
      confidence: "community_reported" as const,
      captured_at: NOW,
    };
    const current = { name: "Sample Cafe", type: "specialty_cafe", lat: "31.520600", lng: "74.358500", has_wifi: true };
    expect(diffRecord("place", current, place).action).toBe("reconfirm");
    expect(diffRecord("place", { ...current, lat: "31.530000" }, place).diff).toHaveProperty("lat");
  });
});
