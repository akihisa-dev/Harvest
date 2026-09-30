import { createStoredZip } from "../core/stored-zip.js";
function checksumInWorker(worker, blob, id, signal) {
    if (signal?.aborted)
        throw new DOMException("ZIP作成を中止しました。", "AbortError");
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            signal?.removeEventListener("abort", onAbort);
        };
        const onMessage = (event) => {
            if (event.data.id !== id)
                return;
            cleanup();
            if (event.data.error !== undefined)
                reject(new Error(event.data.error));
            else if (event.data.checksum === undefined)
                reject(new Error("ZIPのCRC確認に失敗しました。"));
            else
                resolve(event.data.checksum);
        };
        const onError = () => {
            cleanup();
            reject(new Error("ZIPのCRC確認に失敗しました。"));
        };
        const onAbort = () => {
            cleanup();
            reject(new DOMException("ZIP作成を中止しました。", "AbortError"));
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError, { once: true });
        signal?.addEventListener("abort", onAbort, { once: true });
        worker.postMessage({ id, blob });
    });
}
/** Keep ZIP checksum work off the panel thread; terminate it on every completion path. */
export async function createStoredZipInWorker(entries, options = {}) {
    if (typeof Worker === "undefined")
        return createStoredZip(entries, options);
    const worker = new Worker(new URL("./stored-zip-crc-worker.js", import.meta.url), { type: "module" });
    let requestId = 0;
    try {
        return await createStoredZip(entries, { ...options, checksum: (blob, signal) => checksumInWorker(worker, blob, ++requestId, signal) });
    }
    finally {
        worker.terminate();
    }
}
