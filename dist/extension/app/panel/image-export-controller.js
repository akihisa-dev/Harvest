import { individualFilename, saveFilesIndividually } from "../../core/export-files.js";
import { isMediaArchiveFormat } from "../../core/export-formats.js";
import { createStoredZipInWorker } from "../media/stored-zip-worker.js";
import { prepareImageArchive } from "../media/image-archive-preparation.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { downloadBlob } from "./export-lifecycle.js";
import { createExportOperation } from "./export-operation.js";
import { downloadManagedBlob } from "../browser/managed-download.js";
// Preserve the existing entry-builder API while the core owns archive rules.
export { createImageZipEntries } from "../../core/image-archive.js";
function mediaProgressKind(format) {
    return isMediaArchiveFormat(format) ? "files" : "images";
}
/** Prepares selected image files in order, retries only failures, and saves individual files or one ZIP. */
export function createImageExportController(options) {
    function markUnsaved(work) {
        for (const item of work.selected) {
            if (!work.saved?.has(item))
                work.failed.set(item, t("errorFileSave"));
        }
    }
    const operation = createExportOperation({
        ...options,
        retainAbortedWork(work) {
            if (options.isDisposed() || !work.savingStarted)
                return false;
            markUnsaved(work);
            return true;
        },
    });
    async function exportImages(format) {
        const progressKind = mediaProgressKind(format);
        await operation.start({
            createWork: selected => ({
                format,
                selected,
                prepared: new Map(),
                failed: new Map(),
                saved: new Set(),
            }),
            isCompatible: pending => pending.format === format,
            preparationMessage(retry, completed, total) {
                const message = progressKind === "files"
                    ? (retry ? "retryFiles" : "prepareFiles")
                    : (retry ? "retryImages" : "prepareImages");
                return t(message, { completed, total });
            },
            async run(run) {
                const { work } = run;
                try {
                    const entries = await prepareImageArchive(work, {
                        signal: run.signal,
                        isStopped: () => run.stopped,
                        fallbackFailure: t("errorImageConvert"),
                        onProgress: run.reportPreparation,
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
                        for (const [index, entry] of entries.entries()) {
                            if (run.stopped)
                                return;
                            const item = work.selected[index];
                            if (work.saved?.has(item))
                                continue;
                            const filename = individualFilename(options.getZipFilename(), entry.filename, entries.length);
                            if (format === "mp4") {
                                work.savingStarted = true;
                                run.reportStatus(t("saveFiles", { completed: work.saved?.size ?? 0, total: entries.length }), "busy", `${work.saved?.size ?? 0} / ${entries.length}`);
                                await downloadManagedBlob(entry.blob, filename, run.signal);
                                work.saved?.add(item);
                            }
                            else
                                downloadBlob(entry.blob, filename);
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
                    run.complete();
                }
                catch (error) {
                    if (run.stopped)
                        return;
                    if (work.savingStarted) {
                        markUnsaved(work);
                        run.reportStatus(t("fileFailedSummary", { count: work.failed.size, plural: formatPlural(work.failed.size) }), "error");
                        return;
                    }
                    if (error instanceof RangeError) {
                        work.prepared.clear();
                        work.failed.clear();
                        operation.clear();
                    }
                    run.reportStatus(error instanceof Error ? localizeErrorMessage(error.message, "errorFileSave", true) : t("errorFileSave"), "error");
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
        export: exportImages,
    };
}
