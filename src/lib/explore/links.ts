// Links from imported data are only rendered when they're safe to open.

/** Only http(s) links leave the site (no javascript:/data: from imported data). */
export function safeHttp(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Proof photos: our own /uploads path, or an http(s) URL. */
export function safeImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^\/uploads\/[\w/.-]+\.jpg$/.test(url)) return url;
  return safeHttp(url);
}
