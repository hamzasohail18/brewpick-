import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { pgliteDb, type Db } from "@/lib/db/core";
import { CollectorBlockedError } from "@/lib/domain/source-guard";
import { runCollector } from "../../collectors/lib/runner";
import { ServerBlockedError } from "../../collectors/lib/polite-fetch";
import { freshDb } from "../db/harness";

let pg: PGlite;
let db: Db;
const quiet = { log: () => {}, contactEmail: "ops@brewpick.pk" };
const instantSleep = { sleep: async () => {} };

async function source(slug: string) {
  return (await pg.query<Record<string, unknown>>("select * from sources where slug = $1", [slug])).rows[0];
}

beforeAll(async () => {
  pg = await freshDb();
  db = pgliteDb(pg);
  await pg.exec(`
    insert into sources (slug, name, kind, base_url, automation, automation_notes, robots_checked_at, rate_limit_seconds)
    values ('cafe-website-test', 'Test cafe', 'cafe_website', 'https://cafe.example.com', 'allowed',
            'robots.txt allows /menu; reviewed', now() - interval '10 days', 1);
  `);
});

describe("runCollector", () => {
  test("refuses a source that is not reviewed, and records no run", async () => {
    let ran = false;
    await expect(
      runCollector({ db, slug: "bank-offers-hbl", ...quiet, collect: async () => ((ran = true), { found: 0, staged: 0 }) }),
    ).rejects.toThrow(CollectorBlockedError);
    expect(ran).toBe(false);
    const runs = await pg.query("select 1 from source_runs r join sources s on s.id = r.source_id where s.slug = 'bank-offers-hbl'");
    expect(runs.rows).toHaveLength(0);
  });

  test("refuses human-entry sources", async () => {
    await expect(runCollector({ db, slug: "instagram-manual", ...quiet, collect: async () => ({ found: 0, staged: 0 }) })).rejects.toThrow(
      /human-entry/,
    );
  });

  test("records a successful run and schedules the next check", async () => {
    const fetchImpl = (async (url: string) =>
      new Response(url.endsWith("robots.txt") ? "" : "<html>menu</html>")) as typeof fetch;
    const out = await runCollector({
      db,
      slug: "cafe-website-test",
      ...quiet,
      fetchDeps: { fetchImpl, ...instantSleep },
      collect: async (ctx) => {
        const page = await ctx.fetch("https://cafe.example.com/menu");
        return { found: page.body.includes("menu") ? 3 : 0, staged: 0 };
      },
    });
    expect(out.status).toBe("succeeded");
    const run = (await pg.query<Record<string, unknown>>("select * from source_runs where id = $1", [out.runId])).rows[0];
    expect(run).toMatchObject({ status: "succeeded", records_found: 3 });
    const s = await source("cafe-website-test");
    expect(s.last_checked_at).not.toBeNull();
    expect((s.next_check_at as Date).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
  });

  test("a 403 fails the run and switches the source to not_allowed", async () => {
    const fetchImpl = (async (url: string) =>
      url.endsWith("robots.txt") ? new Response("") : new Response("forbidden", { status: 403 })) as typeof fetch;
    await expect(
      runCollector({
        db,
        slug: "cafe-website-test",
        ...quiet,
        fetchDeps: { fetchImpl, ...instantSleep },
        collect: async (ctx) => {
          await ctx.fetch("https://cafe.example.com/menu");
          return { found: 0, staged: 0 };
        },
      }),
    ).rejects.toThrow(ServerBlockedError);
    const s = await source("cafe-website-test");
    expect(s.automation).toBe("not_allowed");
    expect(s.automation_notes).toMatch(/Auto-disabled by collector/);
    const last = (await pg.query<{ status: string }>("select status from source_runs order by started_at desc limit 1")).rows[0];
    expect(last.status).toBe("failed");
  });
});

describe("database backstop", () => {
  test("source_runs cannot be inserted for a source that is not open to automation", async () => {
    await expect(
      pg.query("insert into source_runs (source_id) select id from sources where slug = 'osm-overpass-lahore'"),
    ).rejects.toThrow(/collector_guard/);
  });

  test("a queued run cannot start after its source is closed off", async () => {
    await pg.exec(`
      insert into sources (slug, name, kind, base_url, automation, automation_notes, robots_checked_at)
      values ('cafe-website-two', 'Two', 'cafe_website', 'https://two.example.com', 'allowed', 'ok', now());
      insert into source_runs (source_id) select id from sources where slug = 'cafe-website-two';
      update sources set automation = 'not_allowed' where slug = 'cafe-website-two';
    `);
    await expect(
      pg.query(
        "update source_runs set status = 'running' where source_id = (select id from sources where slug = 'cafe-website-two')",
      ),
    ).rejects.toThrow(/collector_guard/);
  });
});
