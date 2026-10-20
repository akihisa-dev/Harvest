import { isZipChecksumReply, workerRequestId, type ZipChecksumRequest } from "../contracts/worker-contracts.js";
import {createStoredZip, type StoredZipEntry, type StoredZipOptions} from "../../core/stored-zip.js";

function checksumInWorker(worker: Worker, blob: Blob, id: number, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) throw new DOMException("ZIP作成を中止しました。", "AbortError");
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (finished) return;
      const replyId = workerRequestId(event.data);
      if (replyId !== null && replyId !== id) return;
      if (!isZipChecksumReply(event.data)) { onError(); return; }
      finished = true;
      cleanup();
      if (event.data.error !== undefined) reject(new Error(event.data.error));
      else if (event.data.checksum === undefined) reject(new Error("ZIPのCRC確認に失敗しました。"));
      else resolve(event.data.checksum);
    };
    const onError = (): void => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error("ZIPのCRC確認に失敗しました。"));
    };
    const onAbort = (): void => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new DOMException("ZIP作成を中止しました。", "AbortError"));
    };
    // Each file gets its own allowance; completed files cannot consume the next one's budget.
    const timer = setTimeout(onError, 120_000 + Math.ceil(blob.size / (1024 * 1024)) * 1000);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError, {once: true});
    worker.addEventListener("messageerror", onError, {once: true});
    signal?.addEventListener("abort", onAbort, {once: true});
    if (signal?.aborted) { onAbort(); return; }
    try { worker.postMessage({id, blob} satisfies ZipChecksumRequest); }
    catch { onError(); }
  });
}


/** Keep ZIP checksum work off the panel thread; terminate it on every completion path. */
export async function createStoredZipInWorker(
  entries: readonly StoredZipEntry[],
  options: Omit<StoredZipOptions, "checksum"> = {},
): Promise<Blob> {
  if (typeof Worker === "undefined") return createStoredZip(entries, options);
  const worker = new Worker(new URL("../workers/stored-zip-crc-worker.js", import.meta.url), {type: "module"});
  let requestId = 0;
  try {
    return await createStoredZip(entries, {...options, checksum: (blob, signal) =>
      checksumInWorker(worker, blob, ++requestId, signal)});
  } finally {
    worker.terminate();
  }
}
