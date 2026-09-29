import { createStoredZip } from "../core/stored-zip.js";
import { fetchImage } from "./image-fetch.js";
import { convertImage } from "./image-format.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { PdfImageError } from "./pdf-image-contract.js";
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
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    async function exportImages(format) {
        if (options.isBusy())
            return;
        const selected = [...options.getSelectedItems()];
        if (!selected.length)
            return;
        if (pending && (pending.format !== format || !selectionMatches(selected, pending.selected)))
            pending = null;
        const retry = Boolean(pending?.failed.size);
        const work = pending ?? { format, selected, prepared: new Map(), failed: new Map() };
        const remaining = work.selected.filter(item => !work.prepared.has(item));
        const controller = new AbortController();
        activeController = controller;
        pending = work;
        progress = `0 / ${remaining.length}`;
        options.onBusyChange(true);
        reportStatus(t(retry ? "retryImages" : "prepareImages", { completed: 0, total: remaining.length }), "busy", progress);
        try {
            work.failed.clear();
            for (let index = 0; index < remaining.length; index += 1) {
                if (controller.signal.aborted)
                    return;
                const item = remaining[index];
                try {
                    const fetched = await fetchImage(item.url, { signal: controller.signal });
                    const blob = await convertImage(fetched, format, controller.signal);
                    if (controller.signal.aborted)
                        return;
                    work.prepared.set(item, blob);
                }
                catch (error) {
                    if (controller.signal.aborted)
                        return;
                    const reason = error instanceof Error ? error.message : t("errorImageConvert");
                    work.failed.set(item, reason);
                }
                if (!options.isDisposed()) {
                    progress = `${index + 1} / ${remaining.length}`;
                    reportStatus(t(retry ? "retryImages" : "prepareImages", {
                        completed: index + 1,
                        total: remaining.length,
                    }), "busy", progress);
                }
            }
            if (options.isDisposed() || controller.signal.aborted)
                return;
            if (work.failed.size) {
                options.onCloseViewer();
                reportStatus(t("imageFailedSummary", { count: work.failed.size, plural: formatPlural(work.failed.size) }), "error");
                return;
            }
            const entries = createImageZipEntries(work.selected, work.prepared, format);
            reportStatus(t("zipCreating"), "busy", t("zipCreatingShort"));
            const archive = await createStoredZip(entries, {
                signal: controller.signal,
                onProgress(completed, total) {
                    if (options.isDisposed())
                        return;
                    progress = `${completed} / ${total}`;
                    reportStatus(t("zipCreatingProgress", { completed, total }), "busy", progress);
                },
            });
            if (options.isDisposed() || controller.signal.aborted)
                return;
            download(archive, options.getZipFilename());
            options.onClearSourceUrl();
            pending = null;
            reportStatus(t("exportSaved"), "success");
        }
        catch (error) {
            if (options.isDisposed() || controller.signal.aborted)
                return;
            reportStatus(error instanceof Error ? localizeErrorMessage(error.message, "errorZipCreate", true) : t("errorZipCreate"), "error");
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
        export: exportImages,
    };
}
