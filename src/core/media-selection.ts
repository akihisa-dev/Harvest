import type { ImageItem } from "./images.js";

/** Selects media compatible with the requested archive format. */
export function mediaExportSelection(items: readonly ImageItem[], format: string): ImageItem[] {
  return items.filter(item => {
    const kind = item.kind ?? "image";
    if (format === "original") return true;
    if (format === "gif") return kind === "gif";
    if (format === "mp4") return kind === "video";
    return kind === "image";
  });
}

export function hasStillImages(items: readonly ImageItem[]): boolean {
  return items.some(item => (item.kind ?? "image") === "image");
}
