/** Keep the existing host acceptance, including rejection of raw explicit ports. */
export function isXPageUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url);
}

/** Readers receive browser-normalized hrefs; other callers previously parsed paths. */
export function isXBookmarkUrl(url: string, parsePath = false): boolean {
  if (!isXPageUrl(url)) return false;
  const path = parsePath ? new URL(url).pathname : url.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/, 1)[0]!;
  return /^\/i\/(?:history|bookmarks)(?:\/|$)/i.test(path);
}
