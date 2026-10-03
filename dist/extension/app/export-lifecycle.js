export function selectionsMatch(first, second) {
    return first.length === second.length && first.every((item, index) => item === second[index]);
}
export function downloadBlob(blob, filename) {
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
export function createExportLifecycle(options) {
    let pending = null;
    let activeController = null;
    let progress = "";
    function reportStatus(message, state, nextProgress = "") {
        if (state === "busy")
            progress = nextProgress;
        options.onStatus(message, state, nextProgress);
    }
    return {
        get pending() { return pending; },
        get isRunning() { return activeController !== null; },
        get progress() { return progress; },
        clear() { pending = null; },
        abort() { activeController?.abort(); },
        discardIfSelectionChanged(selected) {
            if (!pending || selectionsMatch(selected, pending.selected))
                return false;
            pending = null;
            return true;
        },
        resolveWork(selected, create, isCompatible = () => true) {
            if (pending && (!selectionsMatch(selected, pending.selected) || !isCompatible(pending)))
                pending = null;
            pending ??= create();
            return pending;
        },
        async run(work, initialMessage, initialProgress, task) {
            if (options.isBusy())
                return;
            const controller = new AbortController();
            const retry = work.failed.size > 0;
            activeController = controller;
            pending = work;
            progress = initialProgress;
            options.onBusyChange(true);
            reportStatus(initialMessage, "busy", initialProgress);
            const run = {
                work,
                signal: controller.signal,
                retry,
                get stopped() { return options.isDisposed() || controller.signal.aborted; },
                reportStatus,
            };
            try {
                await task(run);
            }
            finally {
                if (activeController === controller)
                    activeController = null;
                progress = "";
                if (controller.signal.aborted) {
                    if (!options.retainAbortedWork?.(work)) {
                        work.prepared.clear();
                        work.failed.clear();
                        if (pending === work)
                            pending = null;
                    }
                    if (!options.isDisposed())
                        reportStatus(options.cancelledMessage, "info");
                }
                if (!options.isDisposed()) {
                    options.onBusyChange(false);
                    if (pending === work && work.failed.size)
                        options.onScrollToFailures();
                }
            }
        },
    };
}
