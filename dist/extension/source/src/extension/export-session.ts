import type { ExportFormat, ImageArchiveFormat } from "../core/export-formats.js";
import type { ImageItem } from "../core/images.js";
import { mediaExportSelection } from "../core/media-selection.js";
import {
  deriveExportViewState,
  type CompletedExport,
  type ExportViewState,
  type PendingExportView,
  type PendingImageExportView,
} from "./export-presentation.js";

interface ExportControllerState<TPending extends PendingExportView> {
  readonly pending: TPending | null;
  readonly isRunning: boolean;
  readonly progress: string;
  clear(): void;
  abort(): void;
  discardIfSelectionChanged(selected: readonly ImageItem[]): boolean;
}

interface PdfSessionController extends ExportControllerState<PendingExportView> {
  export(): Promise<void>;
}

interface ImageSessionController extends ExportControllerState<PendingImageExportView> {
  export(format: ImageArchiveFormat): Promise<void>;
}

export interface ExportSessionOptions {
  readonly format: ExportFormat;
  readonly includeSourcePage: boolean;
  readonly getSelectedItems: () => readonly ImageItem[];
  readonly getPdfController: () => PdfSessionController | null;
  readonly getImageController: () => ImageSessionController | null;
  readonly isBusy: () => boolean;
}

export interface ExportSessionState {
  readonly format: ExportFormat;
  readonly includeSourcePage: boolean;
  readonly selected: readonly ImageItem[];
  readonly view: ExportViewState;
}

/** Owns export requests and completion independently of status text and DOM rendering. */
export function createExportSession(options: ExportSessionOptions) {
  let format = options.format;
  let includeSourcePage = options.includeSourcePage;
  let completed: CompletedExport | null = null;
  let activeRequest: CompletedExport | null = null;

  function selectedItems(): ImageItem[] {
    return mediaExportSelection(options.getSelectedItems(), format);
  }

  function discardIncompatibleWork(): void {
    const pdf = options.getPdfController();
    const image = options.getImageController();
    if (format !== "pdf" && pdf?.pending && !pdf.isRunning) pdf.clear();
    if (image?.pending && image.pending.format !== format && !image.isRunning) image.clear();
  }

  return {
    get format() { return format; },
    get includeSourcePage() { return includeSourcePage; },
    get selectedItems(): readonly ImageItem[] { return selectedItems(); },
    get state(): ExportSessionState {
      const selected = selectedItems();
      const pdf = options.getPdfController();
      const image = options.getImageController();
      return {format, includeSourcePage, selected, view: deriveExportViewState({
        format, includeSourcePage, selected, completed,
        pdfPending: pdf?.pending ?? null, imagePending: image?.pending ?? null,
        pdfRunning: pdf?.isRunning ?? false, imageRunning: image?.isRunning ?? false,
        pdfProgress: pdf?.progress ?? "", imageProgress: image?.progress ?? "",
      })};
    },
    setFormat(value: ExportFormat): void {
      format = value;
      discardIncompatibleWork();
    },
    setIncludeSourcePage(value: boolean): void { includeSourcePage = value; },
    invalidateCompletion(): void { completed = null; },
    selectionChanged(): boolean {
      const selected = selectedItems();
      const pdfChanged = options.getPdfController()?.discardIfSelectionChanged(selected) ?? false;
      const imageChanged = options.getImageController()?.discardIfSelectionChanged(selected) ?? false;
      if (pdfChanged || imageChanged) completed = null;
      return pdfChanged || imageChanged;
    },
    clear(): void {
      completed = null;
      options.getPdfController()?.clear();
      options.getImageController()?.clear();
    },
    complete(): void {
      if (activeRequest) completed = activeRequest;
    },
    abort(): void {
      const controller = format === "pdf" ? options.getPdfController() : options.getImageController();
      controller?.abort();
    },
    async start(): Promise<void> {
      if (options.isBusy() || activeRequest) return;
      const selected = selectedItems();
      if (!selected.length) return;
      discardIncompatibleWork();
      const request: CompletedExport = {format, includeSourcePage, selected};
      completed = null;
      activeRequest = request;
      try {
        if (request.format === "pdf") await options.getPdfController()?.export();
        else await options.getImageController()?.export(request.format);
      } finally {
        if (activeRequest === request) activeRequest = null;
        discardIncompatibleWork();
      }
    },
  };
}
