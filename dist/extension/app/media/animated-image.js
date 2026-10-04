import { isAnimationConversionReply } from "../contracts/worker-contracts.js";
import { checkCancelled, MAX_IMAGE_BYTES } from "../contracts/image-data-contract.js";
import { animatedImageType } from "../../core/animated-image.js";
export async function prepareAnimatedImage(fetched, signal, maxBytes = MAX_IMAGE_BYTES) {
    checkCancelled(signal);
    if (fetched.kind !== "bitmap")
        return null;
    const blob = fetched.blob;
    if (!animatedImageType(new Uint8Array(await blob.arrayBuffer())))
        return null;
    checkCancelled(signal);
    if (typeof Worker === "undefined")
        throw new Error("この環境では動く画像をGIFへ変換できません。originalを選んで保存してください。");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new Error("GIF変換後の画像が保存容量の上限を超えています。");
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("../workers/animation-conversion-worker.js", import.meta.url), { type: "module" });
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
            else
                resolve(converted ?? null);
        };
        const abort = () => finish(new DOMException("画像の変換を中止しました。", "AbortError"));
        const timeout = setTimeout(() => finish(new Error("GIFへの変換がタイムアウトしました。")), 120000);
        worker.onmessage = (event) => {
            if (!isAnimationConversionReply(event.data))
                finish(new Error("GIFへの変換結果が空です。"));
            else if (event.data.error)
                finish(new Error(event.data.error));
            else if (event.data.blob && event.data.blob.size > Math.min(maxBytes, MAX_IMAGE_BYTES))
                finish(new Error("GIF変換後の画像が保存容量の上限を超えています。"));
            else if (event.data.blob)
                finish(undefined, event.data.blob);
            else
                finish(new Error("GIFへの変換結果が空です。"));
        };
        worker.onerror = worker.onmessageerror = () => finish(new Error("動く画像をGIFへ変換できませんでした。"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
            abort();
            return;
        }
        try {
            worker.postMessage({ blob, maxBytes: Math.min(maxBytes, MAX_IMAGE_BYTES) });
        }
        catch {
            finish(new Error("動く画像をGIFへ変換できませんでした。"));
        }
    });
}
