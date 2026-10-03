import { individualFilename, saveFilesIndividually } from "../core/export-files.js";
import { isMediaArchiveFormat } from "../core/export-formats.js";
import { createStoredZipInWorker } from "./stored-zip-worker.js";
import { prepareImageArchive } from "./image-archive-preparation.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { createExportLifecycle, downloadBlob } from "./export-lifecycle.js";
// Preserve the existing entry-builder API while the core owns archive rules.
export { createImageZipEntries } from "../core/image-archive.js";
function mediaProgressKind(format) {
    return isMediaArchiveFormat(format) ? "files" : "images";
}
/** Prepares selected image files in order, retries only failures, and saves individual files or one ZIP. */
export function createImageExportController(options) {
    const lifecycle = createExportLifecycle({ ...options, cancelledMessage: t("exportCancelled") });
    async function exportImages(format) {
        if (options.isBusy())
            return;
        const selected = [...options.getSelectedItems()];
        if (!selected.length)
            return;
        const work = lifecycle.resolveWork(selected, () => ({
            format,
            selected,
            prepared: new Map(),
            failed: new Map(),
        }), pending => pending.format === format);
        const retry = work.failed.size > 0;
        const remaining = work.selected.filter(item => !work.prepared.has(item));
        const progressKind = mediaProgressKind(format);
        const progressMessage = progressKind === "files"
            ? (retry ? "retryFiles" : "prepareFiles")
            : (retry ? "retryImages" : "prepareImages");
        await lifecycle.run(work, t(progressMessage, { completed: 0, total: remaining.length }), `0 / ${remaining.length}`, async (run) => {
            try {
                const entries = await prepareImageArchive(work, {
                    signal: run.signal,
                    isStopped: () => run.stopped,
                    fallbackFailure: t("errorImageConvert"),
                    onProgress(completed, total) {
                        if (options.isDisposed())
                            return;
                        run.reportStatus(t(progressMessage, {
                            completed, total,
                        }), "busy", `${completed} / ${total}`);
                    },
                });
                if (run.stopped)
                    return;
                if (work.failed.size) {
                    options.onCloseViewer();
                    run.reportStatus(t(progressKind === "files" ? "fileFailedSummary" : "imageFailedSummary", { count: work.failed.size, plural: formatPlural(work.failed.size) }), "error");
                    return;
                }
                if (!entries)
                    return;
                if (saveFilesIndividually(format, entries.length)) {
                    for (const entry of entries) {
                        if (run.stopped)
                            return;
                        downloadBlob(entry.blob, individualFilename(options.getZipFilename(), entry.filename, entries.length));
                    }
                }
                else {
                    run.reportStatus(t("zipCreating"), "busy", t("zipCreatingShort"));
                    const archive = await createStoredZipInWorker(entries, {
                        signal: run.signal,
                        onProgress(completed, total) {
                            if (options.isDisposed())
                                return;
                            run.reportStatus(t("zipCreatingProgress", { completed, total }), "busy", `${completed} / ${total}`);
                        },
                    });
                    if (run.stopped)
                        return;
                    downloadBlob(archive, options.getZipFilename());
                }
                options.onClearSourceUrl();
                lifecycle.clear();
                options.onCompleted?.();
                run.reportStatus(t("exportSaved"), "success");
            }
            catch (error) {
                if (run.stopped)
                    return;
                if (error instanceof RangeError) {
                    work.prepared.clear();
                    work.failed.clear();
                    lifecycle.clear();
                }
                run.reportStatus(error instanceof Error ? localizeErrorMessage(error.message, "errorFileSave", true) : t("errorFileSave"), "error");
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
        export: exportImages,
    };
}
