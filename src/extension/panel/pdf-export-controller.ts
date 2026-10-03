import type { ImageItem } from "../../core/images.js";
import { createPdf } from "../../core/pdf.js";
import type { PdfImagePage, PdfSourcePageOptions } from "../../core/pdf-types.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { preparePdfImages, PdfImageError } from "../media/pdf-image.js";
import { prepareSourceGlyphs } from "../media/pdf-source-glyphs.js";
import { downloadBlob, type ExportControllerState } from "./export-lifecycle.js";
import { createExportOperation, type ExportControllerOptions } from "./export-operation.js";
import type { MutablePendingExport } from "../contracts/export-contracts.js";

export interface PendingPdfExport {
  readonly selected: readonly ImageItem[];
  readonly prepared: ReadonlyMap<ImageItem, PdfImagePage>;
  readonly failed: ReadonlyMap<ImageItem, string>;
}

interface MutablePendingPdfExport extends MutablePendingExport<PdfImagePage> {}

export interface PdfExportControllerOptions extends ExportControllerOptions {
  readonly getFilename: () => string;
  readonly getSourcePage: (firstSelected: ImageItem, filename: string) => Omit<PdfSourcePageOptions, "glyphs"> | undefined;
}

export interface PdfExportController extends ExportControllerState<PendingPdfExport> {
  export(): Promise<void>;
}

/** Owns image preparation, retry state, PDF assembly, and browser download. */
export function createPdfExportController(options: PdfExportControllerOptions): PdfExportController {
  const operation = createExportOperation<PdfImagePage, MutablePendingPdfExport>(options);

  async function exportPdf(): Promise<void> {
    await operation.start({
      createWork: selected => ({
        selected,
        prepared: new Map<ImageItem, PdfImagePage>(),
        failed: new Map<ImageItem, string>(),
      }),
      preparationMessage: (retry, completed, total) => t(retry ? "retryImages" : "prepareImages", {completed, total}),
      async run(run) {
        const {work, remaining} = run;
        try {
          work.failed.clear();
          let completed = 0;
          await preparePdfImages(remaining, (image, result) => {
            if (result instanceof PdfImageError) work.failed.set(image, result.message);
            else work.prepared.set(image, result);
            completed += 1;
            run.reportPreparation(completed, remaining.length);
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
          run.complete();
        } catch (error) {
          if (run.stopped) return;
          if (!work.prepared.size && !work.failed.size) operation.clear();
          run.reportStatus(
            error instanceof Error ? localizeErrorMessage(error.message, "errorPdfCreate", true) : t("errorPdfCreate"),
            "error",
          );
        }
      },
    });
  }

  return {
    get pending() { return operation.pending; },
    get isRunning() { return operation.isRunning; },
    get progress() { return operation.progress; },
    clear: operation.clear,
    abort: operation.abort,
    discardIfSelectionChanged: operation.discardIfSelectionChanged,
    export: exportPdf,
  };
}
