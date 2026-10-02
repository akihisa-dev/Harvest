class ResultWindow {
  private available: number;
  private readonly waiters: Array<{resolve: () => void; reject: (error: unknown) => void}> = [];
  private closed = false;
  private closeError: unknown;

  constructor(capacity: number) { this.available = capacity; }

  acquire(): Promise<void> | undefined {
    if (this.closed) throw this.closeError;
    if (this.available > 0) { this.available -= 1; return undefined; }
    return new Promise<void>((resolve, reject) => this.waiters.push({resolve, reject}));
  }

  release(): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve();
    else this.available += 1;
  }

  close(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError = error;
    while (this.waiters.length) this.waiters.shift()!.reject(error);
  }
}

export interface PreparationWorkers {
  readonly signal: AbortSignal;
  readonly finished: Promise<void>;
  abort(): void;
  fail(error: unknown): void;
  dispose(): void;
}

/** A slot belongs to a task until its consumer releases the result, not just until fetch ends. */
export function createPreparationWorkers(
  count: number,
  concurrency: number,
  sourceSignal: AbortSignal | undefined,
  task: (index: number, signal: AbortSignal, release: () => void) => Promise<void>,
): PreparationWorkers {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) throw new RangeError("concurrency must be a positive safe integer.");
  const controller = new AbortController();
  const window = new ResultWindow(Math.min(count, concurrency));
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const abort = (): void => {
    controller.abort();
    window.close(controller.signal.reason);
    sourceSignal?.removeEventListener("abort", abort);
  };
  const fail = (error: unknown): void => {
    if (!failed) { failed = true; failure = error; }
    abort();
  };
  sourceSignal?.addEventListener("abort", abort, {once: true});
  if (sourceSignal?.aborted) abort();
  const worker = async (): Promise<void> => {
    try {
      while (nextIndex < count) {
        controller.signal.throwIfAborted();
        const waiting = window.acquire();
        if (waiting) await waiting;
        let released = false;
        const release = (): void => {
          if (released) return;
          released = true;
          window.release();
        };
        try {
          controller.signal.throwIfAborted();
          const index = nextIndex++;
          if (index >= count) { release(); return; }
          await task(index, controller.signal, release);
        } catch (error) {
          release();
          throw error;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) fail(error);
      throw error;
    }
  };
  const workers = Array.from({length: Math.min(count, concurrency)}, () => worker());
  const finished = Promise.allSettled(workers).then(outcomes => {
    if (failed) throw failure;
    controller.signal.throwIfAborted();
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (rejected) throw rejected.reason;
  });
  // Fetch completion can precede the last conversion, so retain cancellation
  // until the consumer has finished with every result.
  return {signal: controller.signal, finished, abort, fail,
    dispose: () => sourceSignal?.removeEventListener("abort", abort)};
}

/** Stops waiting even when an underlying operation ignores its abort signal. */
export function waitForPreparation<T>(result: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(signal.reason); };
    signal.addEventListener("abort", abort, {once: true});
    result.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
