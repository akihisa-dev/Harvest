import { createPdf } from "../core/pdf.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { preparePdfImages, PdfImageError } from "./pdf-image.js";
import { prepareSourceGlyphs } from "./pdf-source-glyphs.js";
import { prefersReducedMotion } from "./motion.js";
/** Owns image preparation, retry state, PDF assembly, and browser download. */
export function createPdfExportController(options) {
    let pending = null;
    let activeController = null;
    let progress = "";
    function reportStatus(message, state, nextProgress = "") {
        if (state === "busy")
            progress = nextProgress;
        options.onStatus(message, state, nextProgress);
    }
    function selectionMatches(selected, candidate) {
        return selected.length === candidate.length && selected.every((item, index) => item === candidate[index]);
    }
    function download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    async function exportPdf() {
        if (options.isBusy())
            return;
        const selected = [...options.getSelectedItems()];
        if (!selected.length)
            return;
        if (pending && !selectionMatches(selected, pending.selected))
            pending = null;
        const retry = Boolean(pending?.failed.size);
        const work = pending ?? { selected, prepared: new Map(), failed: new Map() };
        const remaining = work.selected.filter(item => !work.prepared.has(item));
        const controller = new AbortController();
        activeController = controller;
        progress = `0 / ${remaining.length}`;
        options.onBusyChange(true);
        reportStatus(t(retry ? "retryImages" : "prepareImages", { completed: 0, total: remaining.length }), "busy", progress);
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
                    progress = `${completed} / ${remaining.length}`;
                    reportStatus(t(retry ? "retryImages" : "prepareImages", { completed, total: remaining.length }), "busy", progress);
                }
            }, { signal: controller.signal });
            if (options.isDisposed() || controller.signal.aborted)
                return;
            if (work.failed.size) {
                pending = work;
                options.onCloseViewer();
                reportStatus(t("failedSummary", { count: work.failed.size, plural: formatPlural(work.failed.size) }), "error");
                return;
            }
            const pages = work.selected.map(item => work.prepared.get(item));
            reportStatus(t("pdfCreating"), "busy", `${pages.length} / ${pages.length}`);
            const filename = options.getFilename();
            const sourcePage = options.getSourcePage(work.selected[0], filename);
            const glyphs = sourcePage ? await prepareSourceGlyphs([sourcePage.heading, sourcePage.filename, sourcePage.url], controller.signal) : undefined;
            if (options.isDisposed() || controller.signal.aborted)
                return;
            const blob = createPdf(pages, sourcePage ? { ...sourcePage, glyphs } : undefined);
            download(blob, filename);
            options.onClearSourceUrl();
            pending = null;
            reportStatus(t("pdfSaved", { count: pages.length, plural: formatPlural(pages.length) }), "success");
        }
        catch (error) {
            if (options.isDisposed())
                return;
            pending = work.prepared.size || work.failed.size ? work : null;
            reportStatus(error instanceof Error ? localizeErrorMessage(error.message, "errorPdfCreate", true) : t("errorPdfCreate"), "error");
        }
        finally {
            if (activeController === controller)
                activeController = null;
            progress = "";
            if (!options.isDisposed()) {
                options.onBusyChange(false);
                if (pending === work && work.failed.size)
                    options.onScrollToFailures();
            }
        }
    }
    return {
        get pending() { return pending; },
        get isRunning() { return activeController !== null; },
        get progress() { return progress; },
        clear() { pending = null; },
        abort() { activeController?.abort(); },
        discardIfSelectionChanged(selected) {
            if (!pending || selectionMatches(selected, pending.selected))
                return false;
            pending = null;
            return true;
        },
        export: exportPdf,
    };
}
