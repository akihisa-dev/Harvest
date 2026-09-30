import type { ImageItem } from "./images.js";

/** Conversion formats include still images; original export preserves every selected file. */
export function mediaExportSelection(items: readonly ImageItem[], format: string): ImageItem[] {
  return items.filter(item => format === "original" || (item.kind ?? "image") === "image");
}

export function hasStillImages(items: readonly ImageItem[]): boolean {
  return items.some(item => (item.kind ?? "image") === "image");
}
