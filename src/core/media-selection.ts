import type { ImageItem, MediaImageMetadata } from "./images.js";
import { exportFormatMediaKind } from "./export-formats.js";

/** Selects media compatible with the requested archive format. */
export function mediaExportSelection(items: readonly ImageItem[], format: string): ImageItem[] {
  const kind = exportFormatMediaKind(format);
  return items.filter(item => kind === "all" || (item.kind ?? "image") === kind);
}

export function hasStillImages(items: readonly ImageItem[]): boolean {
  return items.some(item => (item.kind ?? "image") === "image");
}

/** Replace only alternatives explicitly identified by the same media's playback data. */
export function mergeMediaCandidates(
  base: readonly MediaImageMetadata[],
  preferred: readonly (MediaImageMetadata & {variantUrls?: readonly string[]})[],
): MediaImageMetadata[] {
  const superseded = new Set(preferred.flatMap(item => item.kind === "video" ? item.variantUrls ?? [] : []));
  const byUrl = new Map<string, MediaImageMetadata>();
  for (const item of [...base, ...preferred]) {
    if (item.kind === "video" && superseded.has(item.url)) continue;
    const previous = byUrl.get(item.url);
    const previewUrl = item.previewUrl ?? previous?.previewUrl;
    byUrl.set(item.url, {url: item.url, kind: item.kind, ...(previewUrl ? {previewUrl} : {})});
  }
  return [...byUrl.values()];
}
