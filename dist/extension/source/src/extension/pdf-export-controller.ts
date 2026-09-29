import type { ImageItem } from "../core/images.js";
import { createPdf } from "../core/pdf.js";
import type { PdfImagePage, PdfSourcePageOptions } from "../core/pdf-types.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { preparePdfImages, PdfImageError } from "./pdf-image.js";
import { prepareSourceGlyphs } from "./pdf-source-glyphs.js";
import { prefersReducedMotion } from "./motion.js";
import { createExportLifecycle, downloadBlob, type MutablePendingExport } from "./export-lifecycle.js";

export interface PendingPdfExport {
  readonly selected: readonly ImageItem[];
  readonly prepared: ReadonlyMap<ImageItem, PdfImagePage>;
  readonly failed: ReadonlyMap<ImageItem, string>;
}

interface MutablePendingPdfExport extends MutablePendingExport<PdfImagePage> {}

export interface PdfExportControllerOptions {
  readonly getSelectedItems: () => readonly ImageItem[];
  readonly getFilename: () => string;
  readonly getSourcePage: (firstSelected: ImageItem, filename: string) => Omit<PdfSourcePageOptions, "glyphs"> | undefined;
  readonly isBusy: () => boolean;
  readonly isDisposed: () => boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onStatus: (message: string, state: "info" | "busy" | "success" | "error", progress?: string) => void;
  readonly onCloseViewer: () => void;
  readonly onClearSourceUrl: () => void;
  readonly onScrollToFailures: () => void;
}

export interface PdfExportController {
  readonly pending: PendingPdfExport | null;
  readonly isRunning: boolean;
  readonly progress: string;
  clear(): void;
  abort(): void;
  discardIfSelectionChanged(selected: readonly ImageItem[]): boolean;
  export(): Promise<void>;
}

/** Owns image preparation, retry state, PDF assembly, and browser download. */
export function createPdfExportController(options: PdfExportControllerOptions): PdfExportController {
  const lifecycle = createExportLifecycle<PdfImagePage, MutablePendingPdfExport>(options);

  async function exportPdf(): Promise<void> {
    if (options.isBusy()) return;
    const selected = [...options.getSelectedItems()];
    if (!selected.length) return;
    const work = lifecycle.resolveWork(selected, () => ({
      selected,
      prepared: new Map<ImageItem, PdfImagePage>(),
      failed: new Map<ImageItem, string>(),
    }));
    const retry = work.failed.size > 0;
    const remaining = work.selected.filter(item => !work.prepared.has(item));
    await lifecycle.run(
      work,
      t(retry ? "retryImages" : "prepareImages", {completed: 0, total: remaining.length}),
      `0 / ${remaining.length}`,
      async run => {
        try {
          work.failed.clear();
          let completed = 0;
          await preparePdfImages(remaining, (image, result) => {
            if (result instanceof PdfImageError) work.failed.set(image, result.message);
            else work.prepared.set(image, result);
            completed += 1;
            if (!options.isDisposed()) {
              run.reportStatus(
                t(retry ? "retryImages" : "prepareImages", {completed, total: remaining.length}),
                "busy",
                `${completed} / ${remaining.length}`,
              );
            }
          }, {signal: run.signal});
          if (run.stopped) return;
          if (work.failed.size) {
            options.onCloseViewer();
            run.reportStatus(t("failedSummary", {count: work.failed.size, plural: formatPlural(work.failed.size)}), "error");
            return;
          }
          const pages = work.selected.map(item => work.prepared.get(item)!);
          run.reportStatus(t("pdfCreating"), "busy", `${pages.length} / ${pages.length}`);
          const filename = options.getFilename();
          const sourcePage = options.getSourcePage(work.selected[0]!, filename);
          const glyphs = sourcePage ? await prepareSourceGlyphs(
            [sourcePage.heading, sourcePage.filename, sourcePage.url], run.signal,
          ) : undefined;
          if (run.stopped) return;
          const blob = createPdf(pages, sourcePage ? {...sourcePage, glyphs} : undefined);
          downloadBlob(blob, filename);
          options.onClearSourceUrl();
          lifecycle.clear();
          run.reportStatus(t("exportSaved"), "success");
        } catch (error) {
          if (options.isDisposed()) return;
          if (!work.prepared.size && !work.failed.size) lifecycle.clear();
          run.reportStatus(
            error instanceof Error ? localizeErrorMessage(error.message, "errorPdfCreate", true) : t("errorPdfCreate"),
            "error",
          );
        }
      },
    );
  }

  return {
    get pending() { return lifecycle.pending; },
    get isRunning() { return lifecycle.isRunning; },
    get progress() { return lifecycle.progress; },
    clear: lifecycle.clear,
    abort: lifecycle.abort,
    discardIfSelectionChanged: lifecycle.discardIfSelectionChanged,
    export: exportPdf,
  };
}
