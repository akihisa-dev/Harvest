import type {ImageArchiveFormat} from "./export-formats.js";
import type {ImageItem} from "./images.js";

export function saveFilesIndividually(format: ImageArchiveFormat, count: number, items: readonly ImageItem[] = []): boolean {
  return format === "mp4" || count === 1 || (format === "recommend" && items.length > 0 && items.every(item => item.kind === "video"));
}

/** Use the page title for one file and a stable sequence for multiple videos. */
export function individualFilename(zipFilename: string, entryFilename: string, count: number): string {
  const base = zipFilename.replace(/\.zip$/i, "");
  return count === 1 ? `${base}.${entryFilename.split(".").pop()}` : `${base}_${entryFilename}`;
}
