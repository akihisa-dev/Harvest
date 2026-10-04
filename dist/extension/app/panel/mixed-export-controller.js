import { resolveImageExportFormat } from "../../core/export-recommendations.js";
import { createPdf } from "../../core/pdf.js";
import { originalMediaType } from "../../core/media-types.js";
import { indexedExportFilename, pdfSourceFilename, splitSettingsMatch } from "../../core/split-export-formats.js";
import { individualFilename } from "../../core/export-files.js";
import { storedZipDataLimit } from "../../core/stored-zip.js";
import { ImageArchiveLimitError } from "../../core/image-archive.js";
import { prepareMixedExport } from "../media/mixed-export-preparation.js";
import { prepareSourceGlyphs } from "../media/pdf-source-glyphs.js";
import { createStoredZipInWorker } from "../media/stored-zip-worker.js";
import { downloadManagedBlob } from "../browser/managed-download.js";
import { downloadBlob } from "./export-lifecycle.js";
import { createExportOperation } from "./export-operation.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
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
            await operation.start({
                createWork: selected => ({ ...settings, selected, resolvedImageFormat: settings.resolvedImageFormat ?? resolveImageExportFormat(settings.imageFormat, selected), prepared: new Map(), failed: new Map(), saved: new Set() }),
                isCompatible: pending => splitSettingsMatch(pending, settings),
                preparationMessage: (retry, completed, total) => t(retry ? "retryFiles" : "prepareFiles", { completed, total }),
                async run(run) {
                    const { work } = run;
                    try {
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
                                const type = originalMediaType(result.blob.type);
                                if (!type)
                                    throw new Error("保存するデータの形式を確認できません。");
                                entries.push({ filename: indexedExportFilename(index, work.selected.length, type.extension), blob: result.blob });
                            }
                        }
                        if (pages.length) {
                            run.reportStatus(t("pdfCreating"), "busy", `${pages.length} / ${pages.length}`);
                            const filename = indexedExportFilename(pdfIndex, work.selected.length, "pdf");
                            const sourceFilename = pdfSourceFilename(work.selected.length, pdfIndex, entries.length, options.getPdfFilename());
                            const source = work.includeSourcePage ? { heading: t("sourceHeading"), filename: sourceFilename, url: firstPage.sourcePage } : undefined;
                            const glyphs = source ? await prepareSourceGlyphs([source.heading, source.filename, source.url], run.signal) : undefined;
                            if (run.stopped)
                                return;
                            const pdf = createPdf(pages, source ? { ...source, glyphs } : undefined);
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
                                if (videosOnly) {
                                    work.savingStarted = true;
                                    run.reportStatus(t("saveFiles", { completed: work.saved.size, total: entries.length }), "busy", `${work.saved.size} / ${entries.length}`);
                                    await downloadManagedBlob(entry.blob, filename, run.signal);
                                    work.saved.add(item);
                                }
                                else
                                    downloadBlob(entry.blob, filename);
                            }
                        }
                        else {
                            run.reportStatus(t("zipCreating"), "busy", t("zipCreatingShort"));
                            const zip = await createStoredZipInWorker(entries, { signal: run.signal, onProgress(completed, total) { run.reportStatus(t("zipCreatingProgress", { completed, total }), "busy", `${completed} / ${total}`); } });
                            if (run.stopped)
                                return;
                            downloadBlob(zip, options.getZipFilename());
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
