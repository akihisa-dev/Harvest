import type { ImageItem } from "../../core/images.js";
import { createSourcePageLayout } from "../../core/pdf.js";
import {isStillImage, pdfSourceFilename, usesDirectRecordingDownload, type ImageExportFormat, type VideoExportFormat} from "../../core/split-export-formats.js";
import {resolveImageExportFormat, type ResolvedImageExportFormat} from "../../core/export-recommendations.js";
import type { ExportFormat } from "../../core/export-formats.js";
import { originalItemExtension } from "../../core/export-formats.js";
import { replaceLoneSurrogates, sourceTextGraphemes, sourceTextNeedsLineImage, sourceTextDirection, SOURCE_TEXT_FONT_FAMILY } from "../../core/source-text.js";
import { individualFilename } from "../../core/export-files.js";

/** The display only needs failures and selection, never prepared image data. */
export interface PendingExportView {
  readonly selected: readonly ImageItem[];
  readonly failed: ReadonlyMap<ImageItem, string>;
}

export interface CompletedExport {
  readonly resolvedImageFormat?: ResolvedImageExportFormat;
  readonly videoFormat: VideoExportFormat;
  readonly format: ImageExportFormat;
  readonly selected: readonly ImageItem[];
  readonly includeSourcePage: boolean;
}

export type ExportViewState =
  | {readonly phase: "empty"; readonly pending: null; readonly progress: ""}
  | {readonly phase: "ready"; readonly pending: null; readonly progress: ""}
  | {readonly phase: "running"; readonly pending: PendingExportView | null; readonly progress: string}
  | {readonly phase: "retry-required"; readonly pending: PendingExportView; readonly progress: ""}
  | {readonly phase: "saved"; readonly pending: null; readonly progress: ""};

export function imageFilename(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || url); }
  catch { return url; }
}

/** Keep the existing length budget without splitting Unicode or creating hidden filenames. */
export function exportFileBaseName(pageTitle: string, fallback: string): string {
  const encoder = new TextEncoder();
  function normalize(value: string): string {
    const normalized = replaceLoneSurrogates(value)
      .replace(/[\\/:*?"<>|\p{Cc}\p{Noncharacter_Code_Point}]/gu, "_")
      .replace(/^[.\s]+|[.\s]+$/g, "");
    let truncated = "";
    let bytes = 0;
    for (const grapheme of sourceTextGraphemes(normalized)) {
      const graphemeBytes = encoder.encode(grapheme).length;
      // Reserve 55 bytes of a 255-byte component for extensions, sequence,
      // Chrome's .crdownload suffix and collision-avoidance additions.
      if (truncated.length + grapheme.length > 100 || bytes + graphemeBytes > 200) break;
      truncated += grapheme;
      bytes += graphemeBytes;
    }
    // Chrome rejects format controls (including ZWJ) in filenames. Replace
    // the complete affected grapheme, preserving the original length budget.
    return sourceTextGraphemes(truncated).map(grapheme => /\p{Cf}/u.test(grapheme) ? "_" : grapheme)
      .join("").replace(/[.\s]+$/g, "");
  }
  return normalize(pageTitle) || normalize(fallback) || "Harvest";
}

export function createSourcePreview(
  selected: readonly ImageItem[],
  format: ExportFormat,
  includeSourcePage: boolean,
  heading: string,
  filename: string,
): ImageItem | null {
  const first = selected[0];
  if (format !== "pdf" || !includeSourcePage || !first) return null;
  const layout = createSourcePageLayout({heading, filename, url: first.sourcePage});
  const escape = (value: string): string => value.replace(/[&<>"']/g, character =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"})[character]!);
  const text = layout.lines.map(line => {
    const textLength = line.text ? ` textLength="${line.width.toFixed(3)}" lengthAdjust="spacingAndGlyphs"` : "";
    const shaping = sourceTextNeedsLineImage(line.text) ? ` direction="${sourceTextDirection(line.text)}" text-anchor="${sourceTextDirection(line.text) === "rtl" ? "end" : "start"}" font-family="${escape(SOURCE_TEXT_FONT_FAMILY)}"` : "";
    return `<text x="${line.x.toFixed(3)}" y="${(layout.height - line.y).toFixed(3)}" font-size="${line.size}"${textLength}${shaping} xml:space="preserve">${escape(line.text)}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}"><rect width="${layout.width}" height="${layout.height}" fill="white"/><g fill="black" font-family="monospace">${text}</g></svg>`;
  return {url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, sourcePage: first.sourcePage, selected: true};
}

interface ExportPresentationOptions {
  readonly getTitle: () => string;
  readonly getSelection: () => CompletedExport;
  readonly fallbackTitle: string;
  readonly sourceHeading: string;
}

/** Keeps output labels and both preview surfaces tied to the same export selection rules. */
export function createExportPresentation(options: ExportPresentationOptions) {
  function outputFormat(selection: CompletedExport): ExportFormat {
    return selection.resolvedImageFormat ?? resolveImageExportFormat(selection.format, selection.selected);
  }
  function filename(extension: "pdf" | "zip"): string {
    return `${exportFileBaseName(options.getTitle(), options.fallbackTitle)}.${extension}`;
  }

  let previousPreview: {url: string; filename: string; value: ImageItem | null} | undefined;
  function preview(selection: CompletedExport): ImageItem | null {
    const still = selection.selected.filter(isStillImage);
    const sourceFilename = pdfSourceFilename(selection.selected.length,selection.selected.indexOf(still[0]!),selection.selected.length-still.length,filename("pdf"));
    if (outputFormat(selection) !== "pdf" || !selection.includeSourcePage || !still[0]) {
      previousPreview = undefined;
      return null;
    }
    const url = still[0].sourcePage;
    if (previousPreview?.url === url && previousPreview.filename === sourceFilename) return previousPreview.value;
    const value = createSourcePreview(still, "pdf", true, options.sourceHeading, sourceFilename);
    previousPreview = {url, filename: sourceFilename, value};
    return value;
  }

  return {
    get pdfFilename() { return filename("pdf"); },
    get zipFilename() { return filename("zip"); },
    get resultFilename(): string {
      const selection = options.getSelection();
      const {selected,videoFormat} = selection;
      const format = outputFormat(selection);
      if (!selected.length) return filename(format === "pdf" ? "pdf" : "zip");
      const still = selected.filter(isStillImage),pdf = format === "pdf" && still.length > 0;
      const count = format === "pdf" ? selected.length-still.length+(pdf?1:0) : selected.length;
      if (count === 1 && pdf) return filename("pdf");
      const videosOnly=selected.length>0&&selected.every(item=>item.kind === "video");
      if (count > 1 && !(videosOnly&&videoFormat !== "original") && !usesDirectRecordingDownload(selected, videoFormat)) return filename("zip");
      const item=selected[0],original=item?.kind === "video" ? videoFormat === "original" : format === "original";
      const extension=!item ? null : original ? originalItemExtension(item)?.toLowerCase()
        : item.kind === "video" ? videoFormat === "mp3" ? "mp3" : "mp4" : !isStillImage(item) ? "gif" : format === "recommend" ? "png" : format;
      if (!extension) return exportFileBaseName(options.getTitle(),options.fallbackTitle);
      const first=`${"1".padStart(Math.max(3,String(selected.length).length),"0")}.${extension}`;
      return individualFilename(filename("zip"),first,count);
    },
    get sourcePreview() { return preview(options.getSelection()); },
    get viewerPages(): readonly ImageItem[] {
      const selection = options.getSelection();
      const source = preview(selection);
      return source ? [...selection.selected, source] : selection.selected;
    },
  };
}
