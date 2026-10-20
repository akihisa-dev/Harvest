import { isJxlEncodeReply, type JxlEncodeRequest } from "../contracts/worker-contracts.js";

interface PendingEncode {
  readonly bytes: number;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly resolve: (buffer: ArrayBuffer) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly abort?: () => void;
}

let worker: Worker | null = null;
let nextId = 1;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, PendingEncode>();

function cancelledError(): DOMException {
  return new DOMException("JXL変換を中止しました。", "AbortError");
}

function terminateWorker(error: Error): void {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  worker?.terminate();
  worker = null;
  for (const [id, request] of pending) {
    clearTimeout(request.timer);
    if (request.signal && request.abort) request.signal.removeEventListener("abort", request.abort);
    request.reject(error);
    pending.delete(id);
  }
}

function getWorker(): Worker {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
  if (worker) return worker;
  worker = new Worker(new URL("../workers/jxl-encode-worker.js", import.meta.url), {type: "module"});
  const activeWorker = worker;
  worker.onmessage = event => {
    if (worker !== activeWorker) return;
    const reply: unknown = event.data;
    if (!isJxlEncodeReply(reply)) {
      terminateWorker(new Error("JXLの変換結果を読み取れませんでした。"));
      return;
    }
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timer);
    if (request.signal && request.abort) request.signal.removeEventListener("abort", request.abort);
    if (reply.error) request.reject(new Error(reply.error));
    else if (reply.buffer) request.resolve(reply.buffer);
    else request.reject(new Error("JXLの変換結果が空です。"));
    if (pending.size === 0) idleTimer = setTimeout(() => terminateWorker(new Error("JXL encoder idle")), 30_000);
  };
  worker.onerror = () => {
    if (worker === activeWorker) terminateWorker(new Error("JXLの変換に失敗しました。"));
  };
  worker.onmessageerror = () => {
    if (worker === activeWorker) terminateWorker(new Error("JXLの変換結果を読み取れませんでした。"));
  };
  return worker;
}

/** Encode pixels in a reusable worker so large JXL images do not block the panel. */
export function encodeJxl(image: ImageData, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (signal?.aborted) return Promise.reject(cancelledError());
  const activeWorker = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const bytes = image.data.byteLength;
    // Include earlier queued pixels; large encodes get a conservative size-based allowance.
    const queuedBytes = [...pending.values()].reduce((sum, request) => sum + request.bytes, bytes);
    const timeoutMs = 120_000 + Math.ceil(queuedBytes / (1024 * 1024)) * 1000;
    const timer = setTimeout(() => {
      if (worker === activeWorker && pending.has(id)) terminateWorker(new Error("JXLの変換に失敗しました。"));
    }, timeoutMs);
    const request: PendingEncode = signal ? {resolve, reject, signal, bytes, timer} : {resolve, reject, bytes, timer};
    const abort = (): void => terminateWorker(cancelledError());
    const storedRequest: PendingEncode = signal ? {...request, abort} : request;
    pending.set(id, storedRequest);
    signal?.addEventListener("abort", abort, {once: true});
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      const pixels = image.data.buffer as ArrayBuffer;
      activeWorker.postMessage({id, pixels, width: image.width, height: image.height} satisfies JxlEncodeRequest, [pixels]);
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abort);
      const failure = error instanceof Error ? error : new Error("JXLの変換に失敗しました。");
      if (pending.size === 0) terminateWorker(failure);
      reject(failure);
    }
  });
}
