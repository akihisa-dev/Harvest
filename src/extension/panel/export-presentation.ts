import type { ImageItem } from "../../core/images.js";
import { createSourcePageLayout } from "../../core/pdf.js";
import type { ExportFormat, ImageArchiveFormat } from "../../core/export-formats.js";
import { selectionsMatch } from "./export-lifecycle.js";
import { replaceLoneSurrogates } from "../../core/source-text.js";
import { individualFilename, saveFilesIndividually } from "../../core/export-files.js";

/** The display only needs failures and selection, never prepared image data. */
export interface PendingExportView {
  readonly selected: readonly ImageItem[];
  readonly failed: ReadonlyMap<ImageItem, string>;
}

export interface PendingImageExportView extends PendingExportView {
  readonly format: ImageArchiveFormat;
}

export interface CompletedExport {
  readonly format: ExportFormat;
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
  function normalize(value: string): string {
    const truncated = replaceLoneSurrogates(value)
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 100);
    // The title may end with the first half of a surrogate pair after truncation.
    return truncated.replace(/[\ud800-\udbff]$/, "").replace(/[.\s]+$/g, "");
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
    return `<text x="${line.x.toFixed(3)}" y="${(layout.height - line.y).toFixed(3)}" font-size="${line.size}"${textLength} xml:space="preserve">${escape(line.text)}</text>`;
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
  function filename(extension: "pdf" | "zip"): string {
    return `${exportFileBaseName(options.getTitle(), options.fallbackTitle)}.${extension}`;
  }

  function preview(selection: CompletedExport): ImageItem | null {
    return createSourcePreview(selection.selected, selection.format, selection.includeSourcePage, options.sourceHeading, filename("pdf"));
  }

  return {
    get pdfFilename() { return filename("pdf"); },
    get zipFilename() { return filename("zip"); },
    get resultFilename(): string {
      const {format, selected} = options.getSelection();
      if (format === "pdf") return filename("pdf");
      if (!saveFilesIndividually(format, selected.length)) return filename("zip");
      const first = `${"1".padStart(Math.max(3, String(selected.length).length), "0")}.${format}`;
      return individualFilename(filename("zip"), first, selected.length);
    },
    get sourcePreview() { return preview(options.getSelection()); },
    get viewerPages(): readonly ImageItem[] {
      const selection = options.getSelection();
      const source = preview(selection);
      return source ? [...selection.selected, source] : selection.selected;
    },
  };
}

export function deriveExportViewState(options: {
  readonly format: ExportFormat;
  readonly includeSourcePage: boolean;
  readonly selected: readonly ImageItem[];
  readonly completed: CompletedExport | null;
  readonly pdfPending: PendingExportView | null;
  readonly imagePending: PendingImageExportView | null;
  readonly pdfRunning: boolean;
  readonly imageRunning: boolean;
  readonly pdfProgress: string;
  readonly imageProgress: string;
}): ExportViewState {
  const pending = options.format === "pdf"
    ? options.pdfPending
    : options.imagePending?.format === options.format ? options.imagePending : null;
  const running = options.format === "pdf" ? options.pdfRunning : options.imageRunning;
  const progress = options.format === "pdf" ? options.pdfProgress : options.imageProgress;
  if (running) return {phase: "running", pending, progress};
  if (pending?.failed.size) return {phase: "retry-required", pending, progress: ""};
  const saved = options.completed?.format === options.format
    && (options.format !== "pdf" || options.completed.includeSourcePage === options.includeSourcePage)
    && selectionsMatch(options.completed.selected, options.selected);
  if (saved) return {phase: "saved", pending: null, progress: ""};
  return options.selected.length
    ? {phase: "ready", pending: null, progress: ""}
    : {phase: "empty", pending: null, progress: ""};
}
