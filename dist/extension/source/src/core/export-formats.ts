import type { ImageItem } from "./images.js";

/** User-facing order and the accepted persisted format values share one contract. */
export const exportFormats = ["mp4", "gif", "pdf", "jpg", "png", "jxl"] as const;
export type ExportFormat = typeof exportFormats[number];
export type ImageArchiveFormat = Exclude<ExportFormat, "pdf"> | "original";
type MediaKind = NonNullable<ImageItem["kind"]>;

const formatKinds: Readonly<Record<ExportFormat, MediaKind>> = {
  mp4: "video",
  gif: "gif",
  pdf: "image",
  jpg: "image",
  png: "image",
  jxl: "image",
};

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && exportFormats.some(format => format === value);
}

/** Unknown legacy callers retain the still-image selection used by the old API. */
export function exportFormatMediaKind(format: string): MediaKind | "all" {
  if (format === "original") return "all";
  return isExportFormat(format) ? formatKinds[format] : "image";
}

export function isMediaArchiveFormat(format: string): boolean {
  return exportFormatMediaKind(format) !== "image";
}

/** A media-only preference needs a scan before it can become the active format. */
export function restoredExportFormat(format: ExportFormat): ExportFormat {
  return formatKinds[format] === "image" ? format : "pdf";
}

export function initialExportFormat(items: readonly ImageItem[], saved: ExportFormat): ExportFormat {
  if (items.some(item => item.kind === "video")) return "mp4";
  if (items.some(item => item.kind === "gif")) return "gif";
  return restoredExportFormat(saved);
}

export function availableExportFormats(items: readonly ImageItem[]): readonly ExportFormat[] {
  const kinds = new Set(items.map(item => item.kind ?? "image"));
  if (items.length === 0) kinds.add("image");
  return exportFormats.filter(format => kinds.has(formatKinds[format]));
}
