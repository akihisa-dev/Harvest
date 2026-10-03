import type { ExportFormat, ImageArchiveFormat } from "../../core/export-formats.js";
import type { ImageItem } from "../../core/images.js";
import { mediaExportSelection } from "../../core/media-selection.js";
import type { ExportControllerState } from "./export-lifecycle.js";
import {
  deriveExportViewState,
  type CompletedExport,
  type ExportViewState,
  type PendingExportView,
  type PendingImageExportView,
} from "./export-presentation.js";

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
  let activeRequest: {
    readonly snapshot: CompletedExport;
    readonly abort: () => void;
    acceptsCompletion: boolean;
  } | null = null;

  function invalidateCompletion(): void {
    completed = null;
    if (activeRequest) activeRequest.acceptsCompletion = false;
  }

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
      const view = deriveExportViewState({
        format,
        includeSourcePage,
        selected,
        completed,
        pdfPending: pdf?.pending ?? null,
        imagePending: image?.pending ?? null,
        pdfRunning: pdf?.isRunning ?? false,
        imageRunning: image?.isRunning ?? false,
        pdfProgress: pdf?.progress ?? "",
        imageProgress: image?.progress ?? "",
      });
      return {format, includeSourcePage, selected, view};
    },
    setFormat(value: ExportFormat): void {
      format = value;
      discardIncompatibleWork();
    },
    setIncludeSourcePage(value: boolean): void { includeSourcePage = value; },
    invalidateCompletion,
    selectionChanged(): boolean {
      const selected = selectedItems();
      const pdfChanged = options.getPdfController()?.discardIfSelectionChanged(selected) ?? false;
      const imageChanged = options.getImageController()?.discardIfSelectionChanged(selected) ?? false;
      if (pdfChanged || imageChanged) completed = null;
      return pdfChanged || imageChanged;
    },
    clear(): void {
      invalidateCompletion();
      options.getPdfController()?.clear();
      options.getImageController()?.clear();
    },
    complete(): void {
      if (activeRequest?.acceptsCompletion) completed = activeRequest.snapshot;
    },
    abort(): void {
      if (activeRequest) {
        activeRequest.acceptsCompletion = false;
        activeRequest.abort();
      }
    },
    async start(): Promise<void> {
      if (options.isBusy() || activeRequest) return;
      const selected = selectedItems();
      if (!selected.length) return;
      discardIncompatibleWork();
      const pdf = options.getPdfController();
      const image = options.getImageController();
      const controller = format === "pdf" ? pdf : image;
      if (!controller) return;
      const snapshot: CompletedExport = {format, includeSourcePage, selected};
      const request = {snapshot, abort: () => controller.abort(), acceptsCompletion: true};
      completed = null;
      activeRequest = request;
      try {
        if (snapshot.format === "pdf") await pdf?.export();
        else await image?.export(snapshot.format);
      } finally {
        if (activeRequest === request) activeRequest = null;
        discardIncompatibleWork();
      }
    },
  };
}
