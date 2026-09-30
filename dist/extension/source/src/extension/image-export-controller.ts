import type { ImageItem } from "../core/images.js";
import { createStoredZip } from "../core/stored-zip.js";
import { fetchImage } from "./image-fetch.js";
import { convertImage, type ImageArchiveFormat } from "./image-format.js";
import type { FetchedImage } from "./image-data-contract.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { createExportLifecycle, downloadBlob, type MutablePendingExport } from "./export-lifecycle.js";

const IMAGE_FETCH_CONCURRENCY = 3;

type ImageFetchOutcome =
  | { readonly ok: true; readonly fetched: FetchedImage }
  | { readonly ok: false; readonly error: unknown };

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return {promise, resolve};
}

/** Limits fetched and in-flight results together until ordered conversion consumes them. */
class ImageFetchWindow {
  private available: number;
  private readonly waiters: Array<{resolve: () => void; reject: (error: unknown) => void}> = [];
  private closed = false;

  constructor(capacity: number) {
    this.available = capacity;
  }

  acquire(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("image fetch window closed"));
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => this.waiters.push({resolve, reject}));
  }

  release(): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve();
    else this.available += 1;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()!.reject(new Error("image fetch window closed"));
  }
}

export interface PendingImageExport {
  readonly format: ImageArchiveFormat;
  readonly selected: readonly ImageItem[];
  readonly prepared: ReadonlyMap<ImageItem, Blob>;
  readonly failed: ReadonlyMap<ImageItem, string>;
}

interface MutablePendingImageExport extends MutablePendingExport<Blob> {
  readonly format: ImageArchiveFormat;
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

export function createImageZipEntries(
  selected: readonly ImageItem[],
  prepared: ReadonlyMap<ImageItem, Blob>,
  format: ImageArchiveFormat,
): Array<{readonly filename: string; readonly blob: Blob}> {
  const width = Math.max(3, String(selected.length).length);
  return selected.map((item, index) => {
    const blob = prepared.get(item);
    if (!blob) throw new RangeError("保存する画像が準備されていません。");
    return {filename: `${String(index + 1).padStart(width, "0")}.${format}`, blob};
  });
}

/** Prepares selected image files in order, retries only failures, and writes one ZIP. */
export function createImageExportController(options: ImageExportControllerOptions): ImageExportController {
  const lifecycle = createExportLifecycle<Blob, MutablePendingImageExport>({...options, cancelledMessage: t("exportCancelled")});

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
      t(retry ? "retryImages" : "prepareImages", {completed: 0, total: remaining.length}),
      `0 / ${remaining.length}`,
      async run => {
        try {
          work.failed.clear();
          const workerCount = Math.min(IMAGE_FETCH_CONCURRENCY, remaining.length);
          const resultWindow = new ImageFetchWindow(workerCount);
          const fetchedResults = remaining.map(() => createDeferred<ImageFetchOutcome>());
          let nextFetchIndex = 0;
          const cancelledFetchResults = Symbol("cancelled fetch results");
          let resolveCancellation!: () => void;
          const cancellationPromise = new Promise<typeof cancelledFetchResults>(resolve => {
            resolveCancellation = () => resolve(cancelledFetchResults);
          });
          const closeWindow = (): void => {
            resultWindow.close();
            resolveCancellation();
          };
          const fetchWorker = async (): Promise<void> => {
            while (true) {
              try {
                await resultWindow.acquire();
              } catch {
                return;
              }
              if (run.stopped) {
                resultWindow.release();
                return;
              }
              const index = nextFetchIndex++;
              if (index >= remaining.length) {
                resultWindow.release();
                return;
              }
              const item = remaining[index]!;
              let outcome: ImageFetchOutcome;
              try {
                outcome = {
                  ok: true,
                  fetched: await fetchImage(item.url, {signal: run.signal, sourcePage: item.sourcePage}),
                };
              } catch (error) {
                outcome = {ok: false, error};
              }
              fetchedResults[index]!.resolve(outcome);
              // The permit stays occupied until this result has been converted or rejected.
            }
          };
          const workers = Array.from({length: workerCount}, () => fetchWorker());
          if (run.signal.aborted) closeWindow();
          else run.signal.addEventListener("abort", closeWindow, {once: true});
          try {
            for (let index = 0; index < remaining.length; index += 1) {
              if (run.stopped) return;
              const outcome = await Promise.race([fetchedResults[index]!.promise, cancellationPromise]);
              if (outcome === cancelledFetchResults || run.stopped) return;
              const item = remaining[index]!;
              try {
                if (!outcome.ok) throw outcome.error;
                const blob = await convertImage(outcome.fetched, format, run.signal);
                if (run.stopped) return;
                work.prepared.set(item, blob);
              } catch (error) {
                if (run.stopped) return;
                const reason = error instanceof Error ? error.message : t("errorImageConvert");
                work.failed.set(item, reason);
              } finally {
                resultWindow.release();
              }
              if (!options.isDisposed()) {
                run.reportStatus(t(retry ? "retryImages" : "prepareImages", {
                  completed: index + 1,
                  total: remaining.length,
                }), "busy", `${index + 1} / ${remaining.length}`);
              }
            }
          } finally {
            run.signal.removeEventListener("abort", closeWindow);
            resultWindow.close();
            await Promise.all(workers);
          }
          if (run.stopped) return;
          if (work.failed.size) {
            options.onCloseViewer();
            run.reportStatus(t("imageFailedSummary", {count: work.failed.size, plural: formatPlural(work.failed.size)}), "error");
            return;
          }

          const entries = createImageZipEntries(work.selected, work.prepared, format);
          run.reportStatus(t("zipCreating"), "busy", t("zipCreatingShort"));
          const archive = await createStoredZip(entries, {
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
          run.reportStatus(t("exportSaved"), "success");
        } catch (error) {
          if (run.stopped) return;
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
