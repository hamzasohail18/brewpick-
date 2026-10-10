// Minimal robots.txt support (RFC 9309): user-agent groups, Allow/Disallow with longest match,
// `*` and `$` wildcards, and Crawl-delay (non-standard but widely used; we honour it as a minimum delay).

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelaySeconds: number | null;
}

interface Group {
  agents: string[];
  rules: RobotsRules;
}

function parseGroups(txt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [], crawlDelaySeconds: null } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.rules.allow.push(value);
    else if (key === "disallow" && value) current.rules.disallow.push(value);
    else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.rules.crawlDelaySeconds = n;
    }
  }
  return groups;
}

/** Rules that apply to `userAgent` (product token match, else the `*` group, else allow-all). */
export function rulesFor(robotsTxt: string, userAgent: string): RobotsRules {
  const groups = parseGroups(robotsTxt);
  const token = userAgent.split("/")[0].trim().toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return chosen.reduce<RobotsRules>(
    (acc, g) => ({
      allow: [...acc.allow, ...g.rules.allow],
      disallow: [...acc.disallow, ...g.rules.disallow],
      crawlDelaySeconds: g.rules.crawlDelaySeconds ?? acc.crawlDelaySeconds,
    }),
    { allow: [], disallow: [], crawlDelaySeconds: null },
  );
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Longest matching rule wins; on a tie, Allow wins. No matching rule = allowed. */
export function isPathAllowed(rules: RobotsRules, pathWithQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  const consider = (patterns: string[], allow: boolean) => {
    for (const p of patterns) {
      if (!patternToRegex(p).test(pathWithQuery)) continue;
      if (!best || p.length > best.len || (p.length === best.len && allow)) best = { len: p.length, allow };
    }
  };
  consider(rules.disallow, false);
  consider(rules.allow, true);
  return best === null ? true : (best as { allow: boolean }).allow;
}
