import {mediaFormat, type ImageItem} from "./images.js";
import type {ImageExportFormat} from "./split-export-formats.js";

export type ExportFormat = ImageExportFormat | "mp4" | "gif";
export type ImageArchiveFormat = Exclude<ExportFormat, "pdf">;

export function isMediaArchiveFormat(format: string): boolean {
  return ["original", "recommend", "mp4", "gif"].includes(format);
}

/** URL-derived labels are hints; original downloads use their validated response MIME type. */
export function originalItemExtension(item: ImageItem): string | null {
  if (item.originalExtension) return item.originalExtension.toUpperCase();
  if (item.kind === "gif") return "GIF";
  const {extension} = mediaFormat(item.url);
  return extension === "不明" ? null : extension;
}
