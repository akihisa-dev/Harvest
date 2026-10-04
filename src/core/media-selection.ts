import type {MediaImageMetadata} from "./images.js";

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
