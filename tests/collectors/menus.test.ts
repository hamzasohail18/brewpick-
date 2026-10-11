import { beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { parseMenuPage } from "@collectors/website/parse";
import { collectWebsiteMenu } from "@collectors/website";
import { parseMenuText } from "@collectors/menu-file/parse-text";
import { collectMenuFileWith, OCR_LOW_CONFIDENCE } from "@collectors/menu-file";
import { extractMenuText, fileKind } from "@collectors/menu-file/ocr";
import { menuItemsToRecords } from "@collectors/lib/menu";
import { hoursFromKeys } from "@collectors/lib/place-merge";
import { runCollector } from "@collectors/lib/runner";
import { memorySnapshotStore } from "@collectors/lib/snapshots";
import { hoursKeys } from "@/lib/pipeline/records";
import { pgliteDb, type Db } from "@/lib/db/core";
import { freshDb } from "../db/harness";

const fixture = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url));
const jsonLdPage = fixture("website/jsonld-menu.html").toString();
const htmlPage = fixture("website/html-menu.html").toString();

describe("website parser: JSON-LD first", () => {
  const menu = parseMenuPage(jsonLdPage);

  test("reads items, sizes and sections from schema.org Menu", () => {
    expect(menu.method).toBe("json-ld");
    expect(menu.items).toEqual([
      { name: "Cappuccino", section: "Hot coffee", prices: [{ label: "Small", price_pkr: 520 }, { label: "Large", price_pkr: 690 }], calories_kcal: null },
      { name: "Americano 12 oz", section: "Hot coffee", prices: [{ label: null, price_pkr: 450 }], calories_kcal: 15 },
      { name: "Iced Spanish Latte", section: "Cold", prices: [{ label: null, price_pkr: 780 }], calories_kcal: null },
    ]);
  });

  test("skips other currencies and broken JSON, and says so", () => {
    expect(menu.warnings.join(" ")).toMatch(/USD, not PKR/);
    expect(menu.warnings.join(" ")).toMatch(/isn't valid JSON/);
  });

  test("reads openingHoursSpecification, including after-midnight closing", () => {
    expect(menu.hours).toHaveLength(7);
    expect(menu.hours!.find((h) => h.day_of_week === 1)).toEqual({ day_of_week: 1, opens: "08:00", closes: "23:00", is_closed: false });
    expect(menu.hours!.find((h) => h.day_of_week === 6)).toEqual({ day_of_week: 6, opens: "10:00", closes: "01:00", is_closed: false });
  });
});

describe("website parser: HTML fallback", () => {
  const menu = parseMenuPage(htmlPage);
  const byName = Object.fromEntries(menu.items.map((i) => [i.name, i.prices]));

  test("finds cards, size lists, bare marked-up prices and table columns", () => {
    expect(menu.method).toBe("html");
    expect(byName["Flat White"]).toEqual([{ label: null, price_pkr: 560 }]);
    expect(byName["Mocha"]).toEqual([{ label: "Small", price_pkr: 540 }, { label: "Large", price_pkr: 690 }]);
    expect(byName["Cortado"]).toEqual([{ label: null, price_pkr: 480 }]);
    expect(byName["Iced Latte"]).toEqual([{ label: "Regular", price_pkr: 600 }, { label: "Large", price_pkr: 720 }]);
    expect(byName["Caramel Frappe"]).toEqual([{ label: "Regular", price_pkr: 750 }, { label: "Large", price_pkr: 880 }]);
  });

  test("ignores prices in navigation and footers, and warns that names were guessed", () => {
    expect(menu.items).toHaveLength(5);
    expect(menu.warnings[0]).toMatch(/page layout/);
  });

  test("a page with no prices finds nothing rather than guessing", () => {
    expect(parseMenuPage("<html><body><h1>Welcome</h1><p>Open daily</p></body></html>")).toMatchObject({ method: "none", items: [] });
  });
});

describe("menu text parser (OCR / PDF text)", () => {
  test("size headers, inline sizes, volumes, currency marks and sections", () => {
    const { items, unread } = parseMenuText(
      ["HOT COFFEE", "Small   Large", "Cappuccino ....... 450   550", "Americano 12 oz Rs. 400/-", "Espresso Single 300 Double 450", "", "COLD", "Iced Mocha 620 740"].join("\n"),
    );
    expect(unread).toEqual([]);
    expect(items).toEqual([
      { name: "Cappuccino", section: "HOT COFFEE", prices: [{ label: "Small", price_pkr: 450 }, { label: "Large", price_pkr: 550 }], calories_kcal: null },
      { name: "Americano", section: "HOT COFFEE", prices: [{ label: "12 oz", price_pkr: 400 }], calories_kcal: null },
      { name: "Espresso", section: "HOT COFFEE", prices: [{ label: "Single", price_pkr: 300 }, { label: "Double", price_pkr: 450 }], calories_kcal: null },
      { name: "Iced Mocha", section: "COLD", prices: [{ label: "Small", price_pkr: 620 }, { label: "Large", price_pkr: 740 }], calories_kcal: null },
    ]);
  });

  test("fixes O/0 and l/1 only inside numbers; keeps calories; reports what it can't read", () => {
    const { items, unread, warnings } = parseMenuText("Latte 45O 120 kcal\nMocha 5l0\nCall 0300 1234567\nTea 250 300 350");
    expect(items[0]).toEqual({ name: "Latte", section: null, prices: [{ label: null, price_pkr: 450 }], calories_kcal: 120 });
    expect(items[1].prices).toEqual([{ label: null, price_pkr: 510 }]);
    expect(unread).toEqual(["Call 0300 1234567"]);
    expect(items[2].prices.map((p) => p.label)).toEqual(["Option 1", "Option 2", "Option 3"]);
    expect(warnings.join(" ")).toMatch(/"Tea" has 3 prices but no size labels/);
  });
});

describe("menu records", () => {
  test("one price record per size, volume assumptions flagged, nutrition only when the menu states it", () => {
    const recs = menuItemsToRecords(parseMenuPage(jsonLdPage).items, {
      placeId: "00000000-0000-0000-0000-000000000001",
      drinkTypes: [{ slug: "cappuccino", aliases: [] }, { slug: "spanish-latte", aliases: [] }],
      channel: "dine_in",
      sourceUrl: "https://cafe.example.com/menu",
      confidence: "verified",
      capturedAt: "2026-10-11T10:00:00+05:00",
    }) as { kind: string; item?: Record<string, unknown> }[];
    expect(recs.filter((r) => r.kind === "item_price")).toHaveLength(4);
    expect(recs[0]).toMatchObject({ item: { display_name: "Cappuccino", drink_type_slug: "cappuccino" }, size: { size_label: "Small", volume_ml: 240, volume_is_assumed: true } });
    const iced = recs.find((r) => r.item?.display_name === "Iced Spanish Latte")!;
    expect(iced.item).toMatchObject({ drink_type_slug: "spanish-latte", temperature: "iced" });
    expect(recs.filter((r) => r.kind === "nutrition")).toEqual([
      expect.objectContaining({ item_display_name: "Americano 12 oz", calories_kcal: 15, size_label: "Regular", assumptions: null }),
    ]);
  });

  test("hours keys round-trip", () => {
    const h = parseMenuPage(jsonLdPage).hours!;
    expect(hoursKeys(hoursFromKeys(hoursKeys(h)))).toEqual(hoursKeys(h));
  });
});

describe("text extraction", () => {
  test("file kind from content type or extension", () => {
    expect(fileKind("application/pdf", "https://x.example.com/m")).toBe("pdf");
    expect(fileKind(null, "https://x.example.com/menu.JPG")).toBe("image");
    expect(fileKind("text/html", "https://x.example.com/menu")).toBeNull();
  });

  test("PDF text layer", async () => {
    const out = await extractMenuText("pdf", new Uint8Array(fixture("menu-file/menu.pdf")));
    expect(out.method).toBe("pdf-text");
    expect(parseMenuText(out.text).items.map((i) => i.name)).toEqual(["Cappuccino", "Cafe Latte", "Americano", "Espresso", "Iced Mocha"]);
  });

  test("OCR of a menu image (Tesseract, local English model)", async () => {
    const out = await extractMenuText("image", new Uint8Array(fixture("menu-file/menu.png")));
    expect(out.method).toBe("ocr");
    expect(out.confidence).toBeGreaterThan(OCR_LOW_CONFIDENCE);
    const items = parseMenuText(out.text).items;
    expect(items.find((i) => i.name === "Cafe Latte")?.prices).toEqual([{ label: "Small", price_pkr: 480 }, { label: "Large", price_pkr: 590 }]);
    expect(items).toHaveLength(5);
  }, 60_000);
});

describe("website and menu-file collectors end to end", () => {
  let pg: PGlite;
  let db: Db;
  let placeId: string;
  const snapshots = memorySnapshotStore();
  const quiet = { log: () => {}, contactEmail: "ops@brewpick.pk", snapshots };

  const serve = (files: Record<string, { body: BodyInit; type: string }>) =>
    (async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /admin\n");
      const f = files[path];
      return f ? new Response(f.body, { headers: { "content-type": f.type } }) : new Response("not found", { status: 404 });
    }) as typeof fetch;

  beforeAll(async () => {
    pg = await freshDb();
    db = pgliteDb(pg);
    placeId = (
      await pg.query<{ id: string }>(
        `insert into places (slug, name, type, lat, lng, status, phone) values ('fixture-roastery', 'Fixture Roastery', 'specialty_cafe', 31.51, 74.35, 'published', '042 0000000')
         returning id`,
      )
    ).rows[0].id;
    await pg.query(
      `insert into sources (slug, name, kind, base_url, place_id, automation, automation_notes, robots_checked_at, rate_limit_seconds, default_confidence)
       values ('cafe-website-fixture-roastery', 'Fixture Roastery website', 'cafe_website', 'https://roastery.example.com/menu', $1,
               'allowed', 'robots.txt allows /menu; terms reviewed', now(), 1, 'verified'),
              ('cafe-menu-file-fixture-roastery', 'Fixture Roastery menu image', 'cafe_menu_file', 'https://roastery.example.com/menu.png', $1,
               'allowed_with_conditions', 'Openly published menu image; OCR + review', now(), 1, 'verified')`,
      [placeId],
    );
  });

  test("website: stages prices, nutrition and an hours-only place change", async () => {
    const out = await runCollector({
      db,
      slug: "cafe-website-fixture-roastery",
      collect: collectWebsiteMenu,
      fetchDeps: { fetchImpl: serve({ "/menu": { body: jsonLdPage, type: "text/html; charset=utf-8" } }), sleep: async () => {} },
      ...quiet,
    });
    expect(out).toMatchObject({ status: "partial", found: 4 }); // partial: the page had a USD item and broken JSON-LD
    const staged = (
      await pg.query<{ target_table: string; action: string; diff: Record<string, unknown> | null; evidence_url: string }>(
        "select target_table, action, diff, evidence_url from staging_records where status = 'pending_review' order by target_table",
      )
    ).rows;
    expect(staged.map((s) => s.target_table)).toEqual(["item_prices", "item_prices", "item_prices", "item_prices", "nutrition_info", "places"]);
    const place = staged.find((s) => s.target_table === "places")!;
    expect(place.action).toBe("update");
    expect(Object.keys(place.diff!)).toEqual(["hours"]); // phone etc. kept, not proposed for removal
    expect(staged[0].evidence_url).toBe("https://roastery.example.com/menu");
  });

  test("menu image: OCR'd prices are flagged for review and the file is kept as a snapshot", async () => {
    const engine = { recognize: async () => ({ text: "Cappuccino 450\nMocha 5l0", confidence: 61 }) };
    const out = await runCollector({
      db,
      slug: "cafe-menu-file-fixture-roastery",
      collect: collectMenuFileWith(engine),
      fetchDeps: { fetchImpl: serve({ "/menu.png": { body: new Uint8Array(fixture("menu-file/menu.png")), type: "image/png" } }), sleep: async () => {} },
      ...quiet,
    });
    expect(out).toMatchObject({ status: "succeeded", found: 2, staged: 2 });
    const rows = (
      await pg.query<{ flags: string[]; proposed: { price_pkr: number; proof_image_url: string } }>(
        `select flags, proposed from staging_records r join sources s on s.id = r.source_id
          where s.slug = 'cafe-menu-file-fixture-roastery' order by proposed->>'price_pkr'`,
      )
    ).rows;
    expect(rows.map((r) => r.proposed.price_pkr)).toEqual([450, 510]);
    expect(rows[0].flags).toEqual(expect.arrayContaining(["ocr", "ocr_low_confidence"]));
    expect(rows[0].proposed.proof_image_url).toBe("https://roastery.example.com/menu.png");
    const saved = [...snapshots.saved.entries()].find(([k]) => k.endsWith("menu-image"));
    expect(saved?.[1]).toBeInstanceOf(Uint8Array);
  });

  test("a menu file robots.txt disallows is never fetched", async () => {
    await pg.query("update sources set base_url = 'https://roastery.example.com/admin/menu.png' where slug = 'cafe-menu-file-fixture-roastery'");
    await expect(
      runCollector({
        db,
        slug: "cafe-menu-file-fixture-roastery",
        collect: collectMenuFileWith({ recognize: async () => ({ text: "", confidence: 0 }) }),
        fetchDeps: { fetchImpl: serve({}), sleep: async () => {} },
        ...quiet,
      }),
    ).rejects.toThrow(/robots\.txt disallows/);
  });
});
