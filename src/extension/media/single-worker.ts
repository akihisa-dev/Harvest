interface SingleWorkerOptions<T> {
  readonly create: () => Worker;
  readonly request: unknown;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly abortError: () => Error;
  readonly timeoutError: () => Error;
  readonly failureError: () => Error;
  readonly receive: (data: unknown, finish: (error?: Error, value?: T) => void) => void;
}

/** Own only one request's lifetime; media contracts remain with the caller. */
export function runSingleWorker<T>(options: SingleWorkerOptions<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.abortError()); return; }
    const worker = options.create();
    let finished = false;
    const finish = (error?: Error, value?: T): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error); else resolve(value as T);
    };
    const abort = (): void => finish(options.abortError());
    const timer = setTimeout(() => finish(options.timeoutError()), options.timeoutMs);
    worker.onmessage = (event: MessageEvent<unknown>): void => {
      if (!finished) options.receive(event.data, finish);
    };
    worker.onerror = worker.onmessageerror = () => finish(options.failureError());
    options.signal?.addEventListener("abort", abort, {once: true});
    if (options.signal?.aborted) { abort(); return; }
    try { worker.postMessage(options.request); }
    catch { finish(options.failureError()); }
  });
}
