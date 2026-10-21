import { resolveImageExportFormat } from "../../core/export-recommendations.js";
import { createPdf } from "../../core/pdf.js";
import { originalMediaType } from "../../core/media-types.js";
import { indexedExportFilename, pdfSourceFilename, splitSettingsMatch, usesDirectRecordingDownload } from "../../core/split-export-formats.js";
import { individualFilename } from "../../core/export-files.js";
import { storedZipDataLimit } from "../../core/stored-zip.js";
import { ImageArchiveLimitError } from "../../core/image-archive.js";
import { prepareMixedExport } from "../media/mixed-export-preparation.js";
import { prepareSourcePageText } from "../media/pdf-source-glyphs.js";
import { createStoredZipInWorker } from "../media/stored-zip-worker.js";
import { downloadManagedBlob, downloadManagedRecording } from "../browser/managed-download.js";
import { inspectStreamRecording } from "../browser/stream-recording.js";
import { isStreamRecording } from "../../core/stream-recording.js";
import { createExportOperation } from "./export-operation.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
function usesPercentageProgress(work) {
    return work.selected.every(item => item.kind === "video");
}
/** Prepares every selected item before any download, including the aggregated still-image PDF. */
export function createMixedExportController(options) {
    const markUnsaved = (work) => {
        for (const item of work.selected)
            if (!work.saved.has(item))
                work.failed.set(item, t("errorFileSave"));
    };
    const operation = createExportOperation({ ...options,
        retainAbortedWork(work) {
            if (options.isDisposed() || !work.savingStarted)
                return false;
            markUnsaved(work);
            return true;
        },
    });
    return {
        get pending() { return operation.pending; },
        get isRunning() { return operation.isRunning; },
        get progress() { return operation.progress; },
        clear: operation.clear, abort: operation.abort, discardIfSelectionChanged: operation.discardIfSelectionChanged,
        async export(settings) {
            let percentage;
            await operation.start({
                createWork: selected => ({ ...settings, selected, audioFilename: options.getZipFilename(), resolvedImageFormat: settings.resolvedImageFormat ?? resolveImageExportFormat(settings.imageFormat, selected), prepared: new Map(), failed: new Map(), saved: new Set() }),
                isCompatible: pending => splitSettingsMatch(pending, settings),
                preparationProgress(work, completed, total) {
                    if (usesDirectRecordingDownload(work.selected, work.videoFormat))
                        return `${Math.min(99, Math.floor(100 * work.saved.size / work.selected.length))}%`;
                    return (percentage ??= usesPercentageProgress(work))
                        ? `${Math.floor(90 * (total ? completed / total : 1))}%` : `${Math.floor(completed)} / ${total}`;
                },
                preparationMessage: (retry, completed, total) => t(retry ? "retryFiles" : "prepareFiles", { completed, total }),
                async run(run) {
                    const { work } = run;
                    percentage ??= usesPercentageProgress(work);
                    let lastPercent = 90;
                    const finalProgress = (fraction) => {
                        if (!percentage)
                            return `${work.selected.length} / ${work.selected.length}`;
                        lastPercent = Math.max(lastPercent, Math.min(99, Math.floor(90 + 9 * fraction)));
                        return `${lastPercent}%`;
                    };
                    try {
                        if (work.selected.every(item => work.saved.has(item))) {
                            run.complete();
                            return;
                        }
                        if (usesDirectRecordingDownload(work.selected, work.videoFormat)) {
                            let directPercent = Math.floor(100 * work.saved.size / work.selected.length);
                            const reportDownload = (fraction) => {
                                if (run.stopped)
                                    return;
                                directPercent = Math.max(directPercent, Math.min(99, Math.floor(100 * (work.saved.size + fraction) / work.selected.length)));
                                run.reportStatus(t("saveFiles", { completed: work.saved.size, total: work.selected.length }), "busy", `${directPercent}%`);
                            };
                            work.failed.clear();
                            const remaining = work.selected.filter(item => !work.saved.has(item));
                            for (const [index, item] of remaining.entries()) {
                                if (run.stopped)
                                    return;
                                try {
                                    if (!isStreamRecording(item.stream, item.url))
                                        throw new Error("録画ファイルを特定できません。Streamの録画再生ページを開いて解析してください。");
                                    await inspectStreamRecording(item.stream.pageUrl, run.signal);
                                    run.reportPreparation(index + 1, remaining.length);
                                }
                                catch (error) {
                                    if (run.stopped)
                                        return;
                                    work.failed.set(item, error instanceof Error ? error.message : t("errorFileSave"));
                                }
                            }
                            if (work.failed.size) {
                                options.onCloseViewer();
                                run.reportStatus(t("fileFailedSummary", { count: work.failed.size, plural: formatPlural(work.failed.size) }), "error");
                                return;
                            }
                            for (const [index, item] of work.selected.entries()) {
                                if (run.stopped)
                                    return;
                                if (work.saved.has(item))
                                    continue;
                                const filename = individualFilename(options.getZipFilename(), indexedExportFilename(index, work.selected.length, "mp4"), work.selected.length);
                                work.savingStarted = true;
                                reportDownload(0);
                                await downloadManagedRecording(item.stream, filename, run.signal, reportDownload);
                                work.saved.add(item);
                                reportDownload(0);
                            }
                            run.complete();
                            return;
                        }
                        await prepareMixedExport(work, { signal: run.signal, isStopped: () => run.stopped, onProgress: run.reportPreparation });
                        if (run.stopped)
                            return;
                        if (work.failed.size) {
                            options.onCloseViewer();
                            run.reportStatus(t("fileFailedSummary", { count: work.failed.size, plural: formatPlural(work.failed.size) }), "error");
                            return;
                        }
                        const pages = [], entries = [];
                        let firstPage, pdfIndex = -1;
                        for (const [index, item] of work.selected.entries()) {
                            const result = work.prepared.get(item);
                            if ("page" in result) {
                                if (!firstPage) {
                                    firstPage = item;
                                    pdfIndex = index;
                                }
                                pages.push(result.page);
                            }
                            else {
                                const type = result.blob.type === "audio/mpeg" ? { extension: "mp3" } : originalMediaType(result.blob.type);
                                if (!type)
                                    throw new Error("保存するデータの形式を確認できません。");
                                entries.push({ filename: indexedExportFilename(index, work.selected.length, type.extension), blob: result.blob });
                            }
                        }
                        if (pages.length) {
                            run.reportStatus(t("pdfCreating"), "busy", finalProgress(0));
                            const filename = indexedExportFilename(pdfIndex, work.selected.length, "pdf");
                            const sourceFilename = pdfSourceFilename(work.selected.length, pdfIndex, entries.length, options.getPdfFilename());
                            const source = work.includeSourcePage ? { heading: t("sourceHeading"), filename: sourceFilename, url: firstPage.sourcePage } : undefined;
                            const text = source ? await prepareSourcePageText(source, run.signal) : undefined;
                            if (run.stopped)
                                return;
                            const pdf = createPdf(pages, source ? { ...source, ...text } : undefined);
                            entries.push({ filename, blob: pdf });
                            entries.sort((a, b) => a.filename.localeCompare(b.filename));
                        }
                        const bytes = entries.reduce((size, entry) => size + entry.blob.size, 0);
                        if (bytes > storedZipDataLimit(entries.map(entry => entry.filename)))
                            throw new ImageArchiveLimitError();
                        const videosOnly = work.selected.every(item => item.kind === "video");
                        if (entries.length === 1 || (videosOnly && work.videoFormat !== "original")) {
                            for (const [index, entry] of entries.entries()) {
                                if (run.stopped)
                                    return;
                                const item = work.selected[index];
                                if (videosOnly && work.saved.has(item))
                                    continue;
                                const filename = entry.blob.type === "application/pdf" && entries.length === 1 ? options.getPdfFilename()
                                    : individualFilename(options.getZipFilename(), entry.filename, entries.length);
                                work.savingStarted = true;
                                run.reportStatus(t("saveFiles", { completed: work.saved.size, total: entries.length }), "busy", finalProgress(work.saved.size / entries.length));
                                await downloadManagedBlob(entry.blob, filename, run.signal);
                                if (videosOnly)
                                    work.saved.add(item);
                                else
                                    for (const selected of work.selected)
                                        work.saved.add(selected);
                            }
                        }
                        else {
                            run.reportStatus(t("zipCreating"), "busy", finalProgress(0));
                            const zip = await createStoredZipInWorker(entries, { signal: run.signal, onProgress(completed, total) { run.reportStatus(t("zipCreatingProgress", { completed, total }), "busy", finalProgress(total ? completed / total : 0)); } });
                            if (run.stopped)
                                return;
                            work.savingStarted = true;
                            await downloadManagedBlob(zip, options.getZipFilename(), run.signal);
                            for (const item of work.selected)
                                work.saved.add(item);
                        }
                        run.complete();
                    }
                    catch (error) {
                        if (run.stopped)
                            return;
                        if (work.savingStarted)
                            markUnsaved(work);
                        if (error instanceof ImageArchiveLimitError) {
                            work.prepared.clear();
                            work.failed.clear();
                            operation.clear();
                        }
                        run.reportStatus(error instanceof Error ? localizeErrorMessage(error.message, "errorFileSave", true) : t("errorFileSave"), "error");
                    }
                },
            });
        },
    };
}
