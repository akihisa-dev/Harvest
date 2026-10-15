import { isAudioConversionReply } from "../contracts/worker-contracts.js";
import { checkCancelled, MAX_IMAGE_BYTES } from "../contracts/image-data-contract.js";
/** One worker owns one conversion and is released on completion, failure, timeout, or cancellation. */
export function prepareAudio(blob, signal, maxBytes = MAX_IMAGE_BYTES) {
    checkCancelled(signal);
    if (!["video/mp4", "video/webm"].includes(blob.type))
        return Promise.reject(new Error("選択項目と保存データの形式が一致しません。"));
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        return Promise.reject(new Error("音声データが保存容量の上限を超えています。"));
    if (typeof Worker === "undefined")
        return Promise.reject(new Error("この環境では動画から音声を取り出せません。"));
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("../workers/audio-conversion-worker.js", import.meta.url), { type: "module" });
        let finished = false;
        const finish = (error, converted) => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
            worker.terminate();
            if (error)
                reject(error);
            else if (converted)
                resolve(converted);
        };
        const abort = () => finish(new DOMException("音声の取り出しを中止しました。", "AbortError"));
        const timeout = setTimeout(() => finish(new Error("音声の取り出しがタイムアウトしました。")), 120_000);
        worker.onmessage = (event) => {
            if (!isAudioConversionReply(event.data))
                finish(new Error("音声を取り出した結果が空です。"));
            else if (event.data.error)
                finish(new Error(event.data.error));
            else if (event.data.blob && event.data.blob.size > Math.min(maxBytes, MAX_IMAGE_BYTES))
                finish(new Error("音声データが保存容量の上限を超えています。"));
            else if (event.data.blob)
                finish(undefined, event.data.blob);
            else
                finish(new Error("音声を取り出した結果が空です。"));
        };
        worker.onerror = worker.onmessageerror = () => finish(new Error("この環境では動画から音声を取り出せません。"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
            abort();
            return;
        }
        try {
            worker.postMessage({ blob, maxBytes: Math.min(maxBytes, MAX_IMAGE_BYTES) });
        }
        catch {
            finish(new Error("この環境では動画から音声を取り出せません。"));
        }
    });
}
