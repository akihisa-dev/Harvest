import type { ImageItem } from "../../core/images.js";
import type { MutablePendingExport } from "../contracts/export-contracts.js";
import {
  createExportLifecycle,
  type ExportControllerState,
  type ExportLifecycleOptions,
  type ExportRun,
} from "./export-lifecycle.js";
import { t } from "./localization.js";

export interface ExportControllerOptions extends Omit<ExportLifecycleOptions, "cancelledMessage" | "retainAbortedWork"> {
  readonly getSelectedItems: () => readonly ImageItem[];
  readonly onCloseViewer: () => void;
  readonly onClearSourceUrl: () => void;
  readonly onCompleted?: () => void;
}

export interface ExportAttempt<TWork> extends ExportRun<TWork> {
  readonly remaining: readonly ImageItem[];
  reportPreparation(completed: number, total: number): void;
  complete(): void;
}

interface ExportOperationRequest<TWork> {
  readonly createWork: (selected: readonly ImageItem[]) => TWork;
  readonly isCompatible?: (pending: TWork) => boolean;
  readonly preparationMessage: (retry: boolean, completed: number, total: number) => string;
  readonly run: (attempt: ExportAttempt<TWork>) => Promise<void>;
}

interface ExportOperation<TWork> extends ExportControllerState<TWork> {
  start(request: ExportOperationRequest<TWork>): Promise<void>;
}

/** Coordinates one selected export, including retry selection and ordered completion effects. */
export function createExportOperation<TPrepared, TWork extends MutablePendingExport<TPrepared>>(
  options: ExportControllerOptions & Pick<ExportLifecycleOptions<TWork>, "retainAbortedWork">,
): ExportOperation<TWork> {
  const lifecycle = createExportLifecycle<TPrepared, TWork>({...options, cancelledMessage: t("exportCancelled")});

  return {
    get pending() { return lifecycle.pending; },
    get isRunning() { return lifecycle.isRunning; },
    get progress() { return lifecycle.progress; },
    clear: lifecycle.clear,
    abort: lifecycle.abort,
    discardIfSelectionChanged: lifecycle.discardIfSelectionChanged,
    async start(request) {
      // Check ownership before reading selection or resolving retry work.
      if (lifecycle.isRunning || options.isBusy() || options.isDisposed()) return;
      const selected = [...options.getSelectedItems()];
      if (!selected.length) return;
      const work = lifecycle.resolveWork(selected, () => request.createWork(selected), request.isCompatible);
      const remaining = work.selected.filter(item => !work.prepared.has(item));
      const retry = work.failed.size > 0;
      await lifecycle.run(work, request.preparationMessage(retry, 0, remaining.length), `0 / ${remaining.length}`, async run => {
        await request.run({
          work,
          remaining,
          signal: run.signal,
          retry: run.retry,
          get stopped() { return run.stopped; },
          reportStatus: run.reportStatus,
          reportPreparation(completed, total) {
            run.reportStatus(request.preparationMessage(retry, completed, total), "busy", `${completed} / ${total}`);
          },
          complete() {
            if (run.stopped) return;
            options.onClearSourceUrl();
            lifecycle.clear();
            options.onCompleted?.();
            run.reportStatus(t("exportSaved"), "success");
          },
        });
      });
    },
  };
}
