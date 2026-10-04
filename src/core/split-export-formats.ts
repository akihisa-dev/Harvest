import type {ImageItem} from "./images.js";

export const imageExportFormats = ["original", "recommend", "pdf", "jpg", "png", "jxl"] as const;
export const videoExportFormats = ["original", "recommend", "mp4"] as const;
export type ImageExportFormat = typeof imageExportFormats[number];
export type VideoExportFormat = typeof videoExportFormats[number];
export interface SplitExportSettings {
  readonly imageFormat: ImageExportFormat;
  readonly videoFormat: VideoExportFormat;
  readonly includeSourcePage: boolean;
}
export function isImageExportFormat(value: unknown): value is ImageExportFormat {
  return imageExportFormats.some(format => format === value);
}
export function isVideoExportFormat(value: unknown): value is VideoExportFormat {
  return videoExportFormats.some(format => format === value);
}
export function isStillImage(item: ImageItem): boolean {
  return item.kind !== "video" && item.kind !== "gif" && item.recommendedFormat !== "gif";
}
export function splitSettingsMatch(a: SplitExportSettings, b: SplitExportSettings): boolean {
  return a.imageFormat === b.imageFormat && a.videoFormat === b.videoFormat && a.includeSourcePage === b.includeSourcePage;
}
export function indexedExportFilename(index: number, count: number, extension: string): string {
  return `${String(index + 1).padStart(Math.max(3, String(count).length), "0")}.${extension}`;
}

/** A lone PDF uses the page title; a PDF inside a ZIP uses its actual indexed entry name. */
export function pdfSourceFilename(selectedCount: number, pdfIndex: number, otherOutputs: number, directFilename: string): string {
  return otherOutputs > 0 ? indexedExportFilename(pdfIndex,selectedCount,"pdf") : directFilename;
}
