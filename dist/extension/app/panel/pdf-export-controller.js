import { createPdf } from "../../core/pdf.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { preparePdfImages, PdfImageError } from "../media/pdf-image.js";
import { prepareSourceGlyphs } from "../media/pdf-source-glyphs.js";
import { prefersReducedMotion } from "./motion.js";
import { createExportLifecycle, downloadBlob } from "./export-lifecycle.js";
/** Owns image preparation, retry state, PDF assembly, and browser download. */
export function createPdfExportController(options) {
    const lifecycle = createExportLifecycle({ ...options, cancelledMessage: t("exportCancelled") });
    async function exportPdf() {
        if (options.isBusy())
            return;
        const selected = [...options.getSelectedItems()];
        if (!selected.length)
            return;
        const work = lifecycle.resolveWork(selected, () => ({
            selected,
            prepared: new Map(),
            failed: new Map(),
        }));
        const retry = work.failed.size > 0;
        const remaining = work.selected.filter(item => !work.prepared.has(item));
        await lifecycle.run(work, t(retry ? "retryImages" : "prepareImages", { completed: 0, total: remaining.length }), `0 / ${remaining.length}`, async (run) => {
            try {
                work.failed.clear();
                let completed = 0;
                await preparePdfImages(remaining, (image, result) => {
                    if (result instanceof PdfImageError)
                        work.failed.set(image, result.message);
                    else
                        work.prepared.set(image, result);
                    completed += 1;
                    if (!options.isDisposed()) {
                        run.reportStatus(t(retry ? "retryImages" : "prepareImages", { completed, total: remaining.length }), "busy", `${completed} / ${remaining.length}`);
                    }
                }, { signal: run.signal });
                if (run.stopped)
                    return;
                if (work.failed.size) {
                    options.onCloseViewer();
                    run.reportStatus(t("failedSummary", { count: work.failed.size, plural: formatPlural(work.failed.size) }), "error");
                    return;
                }
                const pages = work.selected.map(item => work.prepared.get(item));
                run.reportStatus(t("pdfCreating"), "busy", `${pages.length} / ${pages.length}`);
                const filename = options.getFilename();
                const sourcePage = options.getSourcePage(work.selected[0], filename);
                const glyphs = sourcePage ? await prepareSourceGlyphs([sourcePage.heading, sourcePage.filename, sourcePage.url], run.signal) : undefined;
                if (run.stopped)
                    return;
                const blob = createPdf(pages, sourcePage ? { ...sourcePage, glyphs } : undefined);
                downloadBlob(blob, filename);
                options.onClearSourceUrl();
                lifecycle.clear();
                options.onCompleted?.();
                run.reportStatus(t("exportSaved"), "success");
            }
            catch (error) {
                if (run.stopped)
                    return;
                if (!work.prepared.size && !work.failed.size)
                    lifecycle.clear();
                run.reportStatus(error instanceof Error ? localizeErrorMessage(error.message, "errorPdfCreate", true) : t("errorPdfCreate"), "error");
            }
        });
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
