import { createPreparationWorkers, waitForPreparation } from "../core/preparation-workers.js";
import { isMediaArchiveFormat, exportFormatMediaKind } from "../core/export-formats.js";
import { storedZipDataLimit } from "../core/stored-zip.js";
import { createStoredZipInWorker } from "./stored-zip-worker.js";
import { fetchImage } from "./image-fetch.js";
import { fetchOriginalMedia, originalMediaExtension } from "./media-fetch.js";
import { prepareMp4 } from "./mp4-conversion.js";
import { convertImage } from "./image-format.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { createExportLifecycle, downloadBlob } from "./export-lifecycle.js";
const IMAGE_FETCH_CONCURRENCY = 3;
class ImageArchiveLimitError extends RangeError {
    constructor() { super("ZIP全体がZIP形式の上限を超えています。"); }
}
function imageArchiveFilenames(count, format) {
    const width = Math.max(3, String(count).length);
    // For original media, .jpg is the shortest supported suffix and gives a
    // safe upper bound for payload bytes until the actual MIME types are known.
    const extension = format === "original" ? "jpg" : format;
    return Array.from({ length: count }, (_, index) => `${String(index + 1).padStart(width, "0")}.${extension}`);
}
function mediaProgressKind(format) {
    return isMediaArchiveFormat(format) ? "files" : "images";
}
function validatePreparedMedia(item, blob, format) {
    if (format !== "mp4" && format !== "gif")
        return;
    const expectedKind = exportFormatMediaKind(format);
    let actualExtension;
    try {
        actualExtension = originalMediaExtension(blob.type);
    }
    catch {
        throw new RangeError("保存するデータの形式を確認できません。");
    }
    if ((item.kind ?? "image") !== expectedKind || actualExtension !== format) {
        throw new RangeError("選択項目と保存データの形式が一致しません。");
    }
}
function createDeferred() {
    let resolve;
    const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}
export function createImageZipEntries(selected, prepared, format) {
    return selected.map((item, index) => {
        const blob = prepared.get(item);
        if (!blob)
            throw new RangeError("保存する画像が準備されていません。");
        let extension;
        if (format === "original") {
            try {
                extension = originalMediaExtension(blob.type);
            }
            catch {
                throw new RangeError("保存するデータの形式を確認できません。");
            }
            const kind = item.kind ?? "image";
            if ((kind === "video" && extension !== "mp4" && extension !== "webm") ||
                (kind === "gif" && extension !== "gif") ||
                (kind === "image" && (extension === "mp4" || extension === "webm"))) {
                throw new RangeError("選択項目と保存データの形式が一致しません。");
            }
        }
        else {
            extension = format;
            if (format === "gif" || format === "mp4") {
                validatePreparedMedia(item, blob, format);
            }
        }
        const width = Math.max(3, String(selected.length).length);
        const filename = `${String(index + 1).padStart(width, "0")}.${extension}`;
        return { filename, blob };
    });
}
/** Prepares selected image files in order, retries only failures, and writes one ZIP. */
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
        await lifecycle.run(work, t(mediaProgressKind(format) === "files" ? (retry ? "retryFiles" : "prepareFiles") : (retry ? "retryImages" : "prepareImages"), { completed: 0, total: remaining.length }), `0 / ${remaining.length}`, async (run) => {
            try {
                const dataLimit = storedZipDataLimit(imageArchiveFilenames(work.selected.length, format));
                let preparedSize = [...work.prepared.values()].reduce((size, blob) => size + blob.size, 0);
                if (preparedSize > dataLimit)
                    throw new ImageArchiveLimitError();
                work.failed.clear();
                const isOriginalMedia = isMediaArchiveFormat(format);
                // Preserve the existing opportunity to cancel before ZIP prefetch starts.
                await Promise.resolve();
                if (run.stopped)
                    return;
                const fetchedResults = remaining.map(() => createDeferred());
                const workers = createPreparationWorkers(remaining.length, isOriginalMedia ? 1 : IMAGE_FETCH_CONCURRENCY, run.signal, async (index, signal, release) => {
                    const item = remaining[index];
                    let outcome;
                    try {
                        outcome = {
                            ok: true,
                            fetched: isOriginalMedia
                                ? await fetchOriginalMedia(item.url, item.kind ?? "image", { signal, sourcePage: item.sourcePage })
                                : await fetchImage(item.url, { signal, sourcePage: item.sourcePage }),
                        };
                    }
                    catch (error) {
                        outcome = { ok: false, error };
                    }
                    fetchedResults[index].resolve({ ...outcome, release });
                });
                // Observe failure immediately while conversion consumes the ordered results.
                const fetchCompletion = Promise.allSettled([workers.finished]);
                try {
                    for (let index = 0; index < remaining.length; index += 1) {
                        if (run.stopped)
                            return;
                        const outcome = await waitForPreparation(fetchedResults[index].promise, workers.signal);
                        if (run.stopped)
                            return;
                        const item = remaining[index];
                        try {
                            if (!outcome.ok)
                                throw outcome.error;
                            let blob = isOriginalMedia
                                ? outcome.fetched
                                : await convertImage(outcome.fetched, format, run.signal);
                            if (format === "mp4")
                                blob = await prepareMp4(blob, run.signal, dataLimit - preparedSize);
                            if (run.stopped)
                                return;
                            validatePreparedMedia(item, blob, format);
                            if (blob.size > dataLimit - preparedSize)
                                throw new ImageArchiveLimitError();
                            work.prepared.set(item, blob);
                            preparedSize += blob.size;
                        }
                        catch (error) {
                            if (run.stopped)
                                return;
                            if (error instanceof ImageArchiveLimitError)
                                throw error;
                            const reason = error instanceof Error ? error.message : t("errorImageConvert");
                            work.failed.set(item, reason);
                        }
                        finally {
                            fetchedResults[index] = undefined;
                            outcome.release();
                        }
                        if (!options.isDisposed()) {
                            run.reportStatus(t(mediaProgressKind(format) === "files" ? (retry ? "retryFiles" : "prepareFiles") : (retry ? "retryImages" : "prepareImages"), {
                                completed: index + 1,
                                total: remaining.length,
                            }), "busy", `${index + 1} / ${remaining.length}`);
                        }
                    }
                }
                finally {
                    workers.abort();
                    await fetchCompletion;
                }
                if (run.stopped)
                    return;
                if (work.failed.size) {
                    options.onCloseViewer();
                    run.reportStatus(t(mediaProgressKind(format) === "files" ? "fileFailedSummary" : "imageFailedSummary", { count: work.failed.size, plural: formatPlural(work.failed.size) }), "error");
                    return;
                }
                const entries = createImageZipEntries(work.selected, work.prepared, format);
                const exactDataLimit = storedZipDataLimit(entries.map(entry => entry.filename));
                if (preparedSize > exactDataLimit)
                    throw new ImageArchiveLimitError();
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
