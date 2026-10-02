class ResultWindow {
    available;
    waiters = [];
    closed = false;
    closeError;
    constructor(capacity) { this.available = capacity; }
    acquire() {
        if (this.closed)
            throw this.closeError;
        if (this.available > 0) {
            this.available -= 1;
            return undefined;
        }
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }
    release() {
        if (this.closed)
            return;
        const waiter = this.waiters.shift();
        if (waiter)
            waiter.resolve();
        else
            this.available += 1;
    }
    close(error) {
        if (this.closed)
            return;
        this.closed = true;
        this.closeError = error;
        while (this.waiters.length)
            this.waiters.shift().reject(error);
    }
}
/** A slot belongs to a task until its consumer releases the result, not just until fetch ends. */
export function createPreparationWorkers(count, concurrency, sourceSignal, task) {
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0)
        throw new RangeError("concurrency must be a positive safe integer.");
    const controller = new AbortController();
    const window = new ResultWindow(Math.min(count, concurrency));
    let nextIndex = 0;
    let failed = false;
    let failure;
    const abort = () => {
        controller.abort();
        window.close(controller.signal.reason);
        sourceSignal?.removeEventListener("abort", abort);
    };
    const fail = (error) => {
        if (!failed) {
            failed = true;
            failure = error;
        }
        abort();
    };
    sourceSignal?.addEventListener("abort", abort, { once: true });
    if (sourceSignal?.aborted)
        abort();
    const worker = async () => {
        try {
            while (nextIndex < count) {
                controller.signal.throwIfAborted();
                const waiting = window.acquire();
                if (waiting)
                    await waiting;
                let released = false;
                const release = () => {
                    if (released)
                        return;
                    released = true;
                    window.release();
                };
                try {
                    controller.signal.throwIfAborted();
                    const index = nextIndex++;
                    if (index >= count) {
                        release();
                        return;
                    }
                    await task(index, controller.signal, release);
                }
                catch (error) {
                    release();
                    throw error;
                }
            }
        }
        catch (error) {
            if (!controller.signal.aborted)
                fail(error);
            throw error;
        }
    };
    const workers = Array.from({ length: Math.min(count, concurrency) }, () => worker());
    const finished = Promise.allSettled(workers).then(outcomes => {
        if (failed)
            throw failure;
        controller.signal.throwIfAborted();
        const rejected = outcomes.find((outcome) => outcome.status === "rejected");
        if (rejected)
            throw rejected.reason;
    });
    // Fetch completion can precede the last conversion, so retain cancellation
    // until the consumer has finished with every result.
    return { signal: controller.signal, finished, abort, fail,
        dispose: () => sourceSignal?.removeEventListener("abort", abort) };
}
/** Stops waiting even when an underlying operation ignores its abort signal. */
export function waitForPreparation(result, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => { reject(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        result.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}
