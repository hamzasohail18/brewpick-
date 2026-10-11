/** A same-site path to return to after sign-in (never an absolute URL, so it can't be an open redirect). */
export function safeReturnPath(v: unknown, fallback = "/profile"): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") && !s.startsWith("/admin") ? s : fallback;
}
