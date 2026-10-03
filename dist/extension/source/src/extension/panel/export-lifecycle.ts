import type { ImageItem } from "../../core/images.js";
import type { MutablePendingExport } from "../contracts/export-contracts.js";

export type ExportStatusState = "info" | "busy" | "success" | "error";

export interface ExportLifecycleOptions<TWork = MutablePendingExport<unknown>> {
  readonly cancelledMessage: string;
  readonly isBusy: () => boolean;
  readonly isDisposed: () => boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onStatus: (message: string, state: ExportStatusState, progress?: string) => void;
  readonly onScrollToFailures: () => void;
  readonly retainAbortedWork?: (work: TWork) => boolean;
}

export interface ExportRun<TWork> {
  readonly work: TWork;
  readonly signal: AbortSignal;
  readonly retry: boolean;
  readonly stopped: boolean;
  reportStatus(message: string, state: ExportStatusState, progress?: string): void;
}

export interface ExportControllerState<TPending> {
  readonly pending: TPending | null;
  readonly isRunning: boolean;
  readonly progress: string;
  clear(): void;
  abort(): void;
  discardIfSelectionChanged(selected: readonly ImageItem[]): boolean;
}

export interface ExportLifecycle<TPrepared, TWork extends MutablePendingExport<TPrepared>> extends ExportControllerState<TWork> {
  resolveWork(
    selected: readonly ImageItem[],
    create: () => TWork,
    isCompatible?: (pending: TWork) => boolean,
  ): TWork;
  run(work: TWork, initialMessage: string, initialProgress: string, task: (run: ExportRun<TWork>) => Promise<void>): Promise<void>;
}

export function selectionsMatch(first: readonly ImageItem[], second: readonly ImageItem[]): boolean {
  return first.length === second.length && first.every((item, index) => item === second[index]);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Let Chrome consume the click in the current task before releasing the Blob reference.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Owns the retry work, cancellation, progress, and cleanup shared by every export format. */
export function createExportLifecycle<TPrepared, TWork extends MutablePendingExport<TPrepared>>(
  options: ExportLifecycleOptions<TWork>,
): ExportLifecycle<TPrepared, TWork> {
  let pending: TWork | null = null;
  let activeController: AbortController | null = null;
  let progress = "";

  function reportStatus(message: string, state: ExportStatusState, nextProgress = ""): void {
    if (state === "busy") progress = nextProgress;
    options.onStatus(message, state, nextProgress);
  }

  return {
    get pending() { return pending; },
    get isRunning() { return activeController !== null; },
    get progress() { return progress; },
    clear() { pending = null; },
    abort() { activeController?.abort(); },
    discardIfSelectionChanged(selected) {
      if (!pending || selectionsMatch(selected, pending.selected)) return false;
      pending = null;
      return true;
    },
    resolveWork(selected, create, isCompatible = () => true) {
      if (pending && (!selectionsMatch(selected, pending.selected) || !isCompatible(pending))) pending = null;
      pending ??= create();
      return pending;
    },
    async run(work, initialMessage, initialProgress, task) {
      if (activeController || options.isBusy() || options.isDisposed()) return;
      const controller = new AbortController();
      const retry = work.failed.size > 0;
      activeController = controller;
      pending = work;
      progress = initialProgress;
      options.onBusyChange(true);
      reportStatus(initialMessage, "busy", initialProgress);
      const run: ExportRun<TWork> = {
        work,
        signal: controller.signal,
        retry,
        get stopped() { return activeController !== controller || options.isDisposed() || controller.signal.aborted; },
        reportStatus(message, state, nextProgress) {
          if (!run.stopped) reportStatus(message, state, nextProgress);
        },
      };
      try {
        await task(run);
      } finally {
        if (activeController === controller) activeController = null;
        progress = "";
        if (controller.signal.aborted) {
          if (!options.retainAbortedWork?.(work)) {
            work.prepared.clear();
            work.failed.clear();
            if (pending === work) pending = null;
          }
          if (!options.isDisposed()) reportStatus(options.cancelledMessage, "info");
        }
        if (!options.isDisposed()) {
          options.onBusyChange(false);
          if (pending === work && work.failed.size) options.onScrollToFailures();
        }
      }
    },
  };
}
