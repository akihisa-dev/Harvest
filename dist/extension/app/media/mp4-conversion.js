import { validateOriginalMedia } from "./original-media-validation.js";
import { isMp4ConversionReply } from "../contracts/worker-contracts.js";
import { checkCancelled, MAX_IMAGE_BYTES } from "../contracts/image-data-contract.js";
/** One worker owns one conversion and is released on completion, failure, timeout, or cancellation. */
export function prepareMp4(blob, signal, maxBytes = MAX_IMAGE_BYTES) {
    checkCancelled(signal);
    if (blob.type === "video/mp4")
        return validateOriginalMedia(blob, signal).then(() => blob);
    if (blob.type !== "video/webm")
        return Promise.reject(new Error("選択項目と保存データの形式が一致しません。"));
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        return Promise.reject(new Error("MP4変換後の動画が保存容量の上限を超えています。"));
    if (typeof Worker === "undefined")
        return Promise.reject(new Error("この環境では動画の映像または音声をMP4へ変換できません。"));
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("../workers/mp4-conversion-worker.js", import.meta.url), { type: "module" });
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
        const abort = () => finish(new DOMException("動画の変換を中止しました。", "AbortError"));
        const timeout = setTimeout(() => finish(new Error("MP4への変換がタイムアウトしました。")), 120_000);
        worker.onmessage = (event) => {
            if (!isMp4ConversionReply(event.data))
                finish(new Error("MP4への変換結果が空です。"));
            else if (event.data.error)
                finish(new Error(event.data.error));
            else if (event.data.blob && event.data.blob.size > Math.min(maxBytes, MAX_IMAGE_BYTES))
                finish(new Error("MP4変換後の動画が保存容量の上限を超えています。"));
            else if (event.data.blob)
                finish(undefined, event.data.blob);
            else
                finish(new Error("MP4への変換結果が空です。"));
        };
        worker.onerror = worker.onmessageerror = () => finish(new Error("動画をMP4へ変換できませんでした。"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
            abort();
            return;
        }
        try {
            worker.postMessage({ blob, maxBytes: Math.min(maxBytes, MAX_IMAGE_BYTES) });
        }
        catch {
            finish(new Error("動画をMP4へ変換できませんでした。"));
        }
    });
}
