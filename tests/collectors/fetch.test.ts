import { describe, expect, test } from "vitest";
import { isPathAllowed, rulesFor } from "../../collectors/lib/robots";
import {
  createPoliteFetch,
  OffSourceUrlError,
  RobotsDisallowedError,
  ServerBlockedError,
} from "../../collectors/lib/polite-fetch";
import type { CollectorPolicy } from "@/lib/domain/source-guard";

const ROBOTS = `
# comment
User-agent: *
Disallow: /admin
Disallow: /*.pdf$
Allow: /admin/public

User-agent: BrewPickLahore
Disallow: /private
Crawl-delay: 10
`;

describe("robots.txt", () => {
  test("uses the specific group for our product token", () => {
    const r = rulesFor(ROBOTS, "BrewPickLahore/0.1 (+mailto:x@y.z)");
    expect(r.crawlDelaySeconds).toBe(10);
    expect(isPathAllowed(r, "/private/menu")).toBe(false);
    expect(isPathAllowed(r, "/admin")).toBe(true); // the * group no longer applies
  });

  test("falls back to * with longest-match and wildcards", () => {
    const r = rulesFor(ROBOTS, "SomeOtherBot/1.0");
    expect(isPathAllowed(r, "/admin/settings")).toBe(false);
    expect(isPathAllowed(r, "/admin/public/menu")).toBe(true);
    expect(isPathAllowed(r, "/files/menu.pdf")).toBe(false);
    expect(isPathAllowed(r, "/files/menu.pdf?v=2")).toBe(true);
    expect(isPathAllowed(r, "/menu")).toBe(true);
  });

  test("empty robots.txt allows everything", () => {
    expect(isPathAllowed(rulesFor("", "x"), "/anything")).toBe(true);
  });
});

const policy: CollectorPolicy = {
  sourceId: "s1",
  slug: "test",
  baseUrl: "https://cafe.example.com",
  rateLimitMs: 2000,
  userAgent: "BrewPickLahore/0.1 (+mailto:ops@brewpick.pk)",
  cacheAllowed: true,
  maxCacheDays: null,
};

function fakeNet(routes: Record<string, () => Response>) {
  let clock = 0;
  const calls: { url: string; at: number; ua: string | null }[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, at: clock, ua: new Headers(init?.headers).get("user-agent") });
    const route = routes[new URL(url).pathname];
    return route ? route() : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    sleeps,
    deps: {
      fetchImpl,
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
    },
  };
}

describe("polite fetch", () => {
  test("sends our User-Agent, spaces requests by the rate limit and caches GETs", async () => {
    const net = fakeNet({ "/robots.txt": () => new Response(""), "/menu": () => new Response("<html>menu</html>") });
    const get = createPoliteFetch(policy, net.deps);
    const a = await get("https://cafe.example.com/menu");
    const b = await get("https://cafe.example.com/menu");
    expect(a.body).toContain("menu");
    expect(b.fromCache).toBe(true);
    expect(net.calls.map((c) => c.url)).toEqual(["https://cafe.example.com/robots.txt", "https://cafe.example.com/menu"]);
    expect(net.calls.every((c) => c.ua === policy.userAgent)).toBe(true);
    expect(net.calls[1].at - net.calls[0].at).toBeGreaterThanOrEqual(2000);
  });

  test("honours robots.txt disallow and crawl-delay", async () => {
    const net = fakeNet({
      "/robots.txt": () => new Response("User-agent: *\nDisallow: /secret\nCrawl-delay: 7"),
      "/a": () => new Response("a"),
      "/b": () => new Response("b"),
    });
    const get = createPoliteFetch({ ...policy, cacheAllowed: false }, net.deps);
    await expect(get("https://cafe.example.com/secret/x")).rejects.toThrow(RobotsDisallowedError);
    await get("https://cafe.example.com/a");
    await get("https://cafe.example.com/b");
    const [, a, b] = net.calls;
    expect(b.at - a.at).toBeGreaterThanOrEqual(7000);
  });

  test("refuses URLs outside the source's host", async () => {
    const get = createPoliteFetch(policy, fakeNet({}).deps);
    await expect(get("https://other.example.org/menu")).rejects.toThrow(OffSourceUrlError);
  });

  test("backs off on 429/5xx and retries", async () => {
    let n = 0;
    const net = fakeNet({
      "/robots.txt": () => new Response(""),
      "/menu": () => (++n < 3 ? new Response("busy", { status: 503 }) : new Response("ok")),
    });
    const page = await createPoliteFetch(policy, net.deps)("https://cafe.example.com/menu");
    expect(page.body).toBe("ok");
    expect(net.sleeps).toEqual(expect.arrayContaining([4000, 8000]));
  });

  test("401/403 is a block, not something to retry", async () => {
    const net = fakeNet({ "/robots.txt": () => new Response(""), "/menu": () => new Response("no", { status: 403 }) });
    await expect(createPoliteFetch(policy, net.deps)("https://cafe.example.com/menu")).rejects.toThrow(ServerBlockedError);
    expect(net.calls).toHaveLength(2);
  });
});
