// The only way collectors talk to the network. Everything here comes from the source's registry
// row via CollectorPolicy: User-Agent, delay between requests, caching. It also stays on the
// source's own host and obeys robots.txt.

import type { CollectorPolicy } from "@/lib/domain/source-guard";
import { isPathAllowed, rulesFor, type RobotsRules } from "./robots";

export class ServerBlockedError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`Server refused automated access (${status}) for ${url}`);
    this.name = "ServerBlockedError";
  }
}

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

export class OffSourceUrlError extends Error {
  constructor(
    readonly url: string,
    readonly baseUrl: string,
  ) {
    super(`${url} is outside this source's host (${baseUrl})`);
    this.name = "OffSourceUrlError";
  }
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string | null;
  body: string;
  fromCache: boolean;
}

export interface PoliteFetchDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  /** Set false only for official APIs whose terms replace robots.txt (e.g. Overpass, Google Places). */
  respectRobots?: boolean;
  /** Per-request limit; a hung server fails the attempt instead of the run hanging forever. */
  timeoutMs?: number;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export function createPoliteFetch(policy: CollectorPolicy, deps: PoliteFetchDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const maxRetries = deps.maxRetries ?? 3;
  const respectRobots = deps.respectRobots ?? true;
  const timeoutMs = deps.timeoutMs ?? 120_000;

  const baseHost = new URL(policy.baseUrl).hostname;
  let lastRequestAt = -Infinity;
  let delayMs = policy.rateLimitMs;
  const robotsByOrigin = new Map<string, RobotsRules>();
  const cache = new Map<string, FetchedPage>();

  async function waitTurn() {
    const wait = lastRequestAt + delayMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
  }

  async function rawFetch(url: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await waitTurn();
      let res: Response | null = null;
      try {
        res = await fetchImpl(url, {
          ...init,
          headers: { ...(init?.headers ?? {}), "User-Agent": policy.userAgent },
          signal: AbortSignal.timeout(timeoutMs),
          // Inside Next.js, global fetch is patched for caching; collectors must always hit the network.
          cache: "no-store",
        });
      } catch (err) {
        if (attempt >= maxRetries) throw err;
      }
      if (res && !RETRYABLE.has(res.status)) return res;
      if (res && attempt >= maxRetries) return res;
      const retryAfter = Number(res?.headers.get("retry-after"));
      const backoff = Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, delayMs * 2 ** (attempt + 1));
      await sleep(backoff);
    }
  }

  async function robots(origin: string): Promise<RobotsRules> {
    let rules = robotsByOrigin.get(origin);
    if (!rules) {
      const res = await rawFetch(`${origin}/robots.txt`);
      // 4xx = no robots.txt = no restrictions (RFC 9309); 5xx after retries = assume full disallow.
      const txt = res.ok ? await res.text() : "";
      rules = res.status >= 500 ? { allow: [], disallow: ["/"], crawlDelaySeconds: null } : rulesFor(txt, policy.userAgent);
      robotsByOrigin.set(origin, rules);
      if (rules.crawlDelaySeconds) delayMs = Math.max(delayMs, rules.crawlDelaySeconds * 1000);
    }
    return rules;
  }

  return async function politeFetch(url: string, init?: RequestInit): Promise<FetchedPage> {
    const u = new URL(url);
    if (u.hostname !== baseHost && !u.hostname.endsWith(`.${baseHost}`)) throw new OffSourceUrlError(url, policy.baseUrl);

    const method = (init?.method ?? "GET").toUpperCase();
    const cacheable = policy.cacheAllowed && method === "GET";
    const hit = cacheable ? cache.get(url) : undefined;
    if (hit) return { ...hit, fromCache: true };

    if (respectRobots && !isPathAllowed(await robots(u.origin), u.pathname + u.search)) throw new RobotsDisallowedError(url);

    const res = await rawFetch(url, init);
    if (res.status === 401 || res.status === 403) throw new ServerBlockedError(url, res.status);
    const page: FetchedPage = {
      url,
      status: res.status,
      contentType: res.headers.get("content-type"),
      body: await res.text(),
      fromCache: false,
    };
    if (cacheable && res.ok) cache.set(url, page);
    return page;
  };
}

export type PoliteFetch = ReturnType<typeof createPoliteFetch>;
