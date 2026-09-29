import { createStoredZip } from "../core/stored-zip.js";
import { fetchImage } from "./image-fetch.js";
import { convertImage } from "./image-format.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { createExportLifecycle, downloadBlob } from "./export-lifecycle.js";
export function createImageZipEntries(selected, prepared, format) {
    const width = Math.max(3, String(selected.length).length);
    return selected.map((item, index) => {
        const blob = prepared.get(item);
        if (!blob)
            throw new RangeError("保存する画像が準備されていません。");
        return { filename: `${String(index + 1).padStart(width, "0")}.${format}`, blob };
    });
}
/** Prepares selected image files in order, retries only failures, and writes one ZIP. */
export function createImageExportController(options) {
    const lifecycle = createExportLifecycle(options);
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
        await lifecycle.run(work, t(retry ? "retryImages" : "prepareImages", { completed: 0, total: remaining.length }), `0 / ${remaining.length}`, async (run) => {
            try {
                work.failed.clear();
                for (let index = 0; index < remaining.length; index += 1) {
                    if (run.stopped)
                        return;
                    const item = remaining[index];
                    try {
                        const fetched = await fetchImage(item.url, { signal: run.signal, sourcePage: item.sourcePage });
                        const blob = await convertImage(fetched, format, run.signal);
                        if (run.stopped)
                            return;
                        work.prepared.set(item, blob);
                    }
                    catch (error) {
                        if (run.stopped)
                            return;
                        const reason = error instanceof Error ? error.message : t("errorImageConvert");
                        work.failed.set(item, reason);
                    }
                    if (!options.isDisposed()) {
                        run.reportStatus(t(retry ? "retryImages" : "prepareImages", {
                            completed: index + 1,
                            total: remaining.length,
                        }), "busy", `${index + 1} / ${remaining.length}`);
                    }
                }
                if (run.stopped)
                    return;
                if (work.failed.size) {
                    options.onCloseViewer();
                    run.reportStatus(t("imageFailedSummary", { count: work.failed.size, plural: formatPlural(work.failed.size) }), "error");
                    return;
                }
                const entries = createImageZipEntries(work.selected, work.prepared, format);
                run.reportStatus(t("zipCreating"), "busy", t("zipCreatingShort"));
                const archive = await createStoredZip(entries, {
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
                options.onClearSourceUrl();
                lifecycle.clear();
                run.reportStatus(t("exportSaved"), "success");
            }
            catch (error) {
                if (run.stopped)
                    return;
                run.reportStatus(error instanceof Error ? localizeErrorMessage(error.message, "errorZipCreate", true) : t("errorZipCreate"), "error");
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
