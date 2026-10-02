import {isMediaArchiveFormat, type ImageArchiveFormat} from "../core/export-formats.js";
import type {ImageItem} from "../core/images.js";
import {createStoredZipInWorker} from "./stored-zip-worker.js";
import {prepareImageArchive, type ImageArchiveWork} from "./image-archive-preparation.js";
import {formatPlural, localizeErrorMessage, t} from "./localization.js";
import {createExportLifecycle, downloadBlob} from "./export-lifecycle.js";

// Preserve the existing entry-builder API while the core owns archive rules.
export {createImageZipEntries} from "../core/image-archive.js";

function mediaProgressKind(format: ImageArchiveFormat): "files" | "images" {
  return isMediaArchiveFormat(format) ? "files" : "images";
}

export interface PendingImageExport {
  readonly format: ImageArchiveFormat;
  readonly selected: readonly ImageItem[];
  readonly prepared: ReadonlyMap<ImageItem, Blob>;
  readonly failed: ReadonlyMap<ImageItem, string>;
}

export interface ImageExportControllerOptions {
  readonly getSelectedItems: () => readonly ImageItem[];
  readonly getZipFilename: () => string;
  readonly isBusy: () => boolean;
  readonly isDisposed: () => boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onStatus: (message: string, state: "info" | "busy" | "success" | "error", progress?: string) => void;
  readonly onCloseViewer: () => void;
  readonly onClearSourceUrl: () => void;
  readonly onCompleted?: () => void;
  readonly onScrollToFailures: () => void;
}

export interface ImageExportController {
  readonly pending: PendingImageExport | null;
  readonly isRunning: boolean;
  readonly progress: string;
  clear(): void;
  abort(): void;
  discardIfSelectionChanged(selected: readonly ImageItem[]): boolean;
  export(format: ImageArchiveFormat): Promise<void>;
}

/** Prepares selected image files in order, retries only failures, and writes one ZIP. */
export function createImageExportController(options: ImageExportControllerOptions): ImageExportController {
  const lifecycle = createExportLifecycle<Blob, ImageArchiveWork>({...options, cancelledMessage: t("exportCancelled")});

  async function exportImages(format: ImageArchiveFormat): Promise<void> {
    if (options.isBusy()) return;
    const selected = [...options.getSelectedItems()];
    if (!selected.length) return;
    const work = lifecycle.resolveWork(selected, () => ({
      format,
      selected,
      prepared: new Map<ImageItem, Blob>(),
      failed: new Map<ImageItem, string>(),
    }), pending => pending.format === format);
    const retry = work.failed.size > 0;
    const remaining = work.selected.filter(item => !work.prepared.has(item));
    await lifecycle.run(
      work,
      t(mediaProgressKind(format) === "files" ? (retry ? "retryFiles" : "prepareFiles") : (retry ? "retryImages" : "prepareImages"), {completed: 0, total: remaining.length}),
      `0 / ${remaining.length}`,
      async run => {
        try {
          const entries = await prepareImageArchive(work, {
            signal: run.signal,
            isStopped: () => run.stopped,
            fallbackFailure: t("errorImageConvert"),
            onProgress(completed, total) {
              if (options.isDisposed()) return;
              run.reportStatus(t(mediaProgressKind(format) === "files" ? (retry ? "retryFiles" : "prepareFiles") : (retry ? "retryImages" : "prepareImages"), {
                completed, total,
              }), "busy", `${completed} / ${total}`);
            },
          });
          if (run.stopped) return;
          if (work.failed.size) {
            options.onCloseViewer();
            run.reportStatus(t(mediaProgressKind(format) === "files" ? "fileFailedSummary" : "imageFailedSummary", {count: work.failed.size, plural: formatPlural(work.failed.size)}), "error");
            return;
          }

          if (!entries) return;
          run.reportStatus(t("zipCreating"), "busy", t("zipCreatingShort"));
          const archive = await createStoredZipInWorker(entries, {
            signal: run.signal,
            onProgress(completed, total) {
              if (options.isDisposed()) return;
              run.reportStatus(t("zipCreatingProgress", {completed, total}), "busy", `${completed} / ${total}`);
            },
          });
          if (run.stopped) return;
          downloadBlob(archive, options.getZipFilename());
          options.onClearSourceUrl();
          lifecycle.clear();
          options.onCompleted?.();
          run.reportStatus(t("exportSaved"), "success");
        } catch (error) {
          if (run.stopped) return;
          if (error instanceof RangeError) {
            work.prepared.clear();
            work.failed.clear();
            lifecycle.clear();
          }
          run.reportStatus(
            error instanceof Error ? localizeErrorMessage(error.message, "errorZipCreate", true) : t("errorZipCreate"),
            "error",
          );
        }
      },
    );
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
