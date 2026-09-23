export interface ImageItem {
  url: string;
  sourcePage: string;
  selected: boolean;
}

export function normalizeImageUrls(candidates: readonly string[], pageUrl: string): string[] {
  const found = new Set<string>();
  for (const candidate of candidates) {
    try {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      const url = new URL(trimmed, pageUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      found.add(url.href);
    } catch {
      // A malformed candidate cannot be fetched or exported.
    }
  }
  return [...found];
}

export function imageGroupLabel(imageUrl: string): string {
  const url = new URL(imageUrl);
  const path = url.pathname.split("/").filter(Boolean);
  const folder = path.length > 1 ? path[path.length - 2] : "";
  return folder ? `${url.hostname} / ${decodeURIComponentSafe(folder)}` : url.hostname;
}

export function galleryLinkScore(link: { url: string; label: string }, pageUrl: string): number {
  try {
    const target = new URL(link.url, pageUrl);
    if (target.origin !== new URL(pageUrl).origin || target.href === pageUrl) return -1;
    const text = `${link.label} ${target.pathname}`.toLowerCase();
    const patterns = [/(?:^|[\/_-])gallery(?:[\/_-]|$)/, /(?:^|[\/_-])viewer(?:[\/_-]|$)/, /(?:^|[\/_-])read(?:[\/_-]|$)/, /(?:^|[\/_-])pages?(?:[\/_-]|$)/, /画像一覧/, /全ページ/, /ギャラリー/, /読む/, /続きを見る/];
    return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
  } catch {
    return -1;
  }
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
