import { runSingleWorker } from "./single-worker.js";
import { isAnimationConversionReply } from "../contracts/worker-contracts.js";
import { checkCancelled, MAX_IMAGE_BYTES } from "../contracts/image-data-contract.js";
import { animatedImageType } from "../../core/animated-image.js";
export async function prepareAnimatedImage(fetched, signal, maxBytes = MAX_IMAGE_BYTES) {
    checkCancelled(signal);
    if (fetched.kind !== "bitmap" || fetched.originalJpeg === true)
        return null;
    const blob = fetched.blob;
    if (!animatedImageType(new Uint8Array(await blob.arrayBuffer())))
        return null;
    checkCancelled(signal);
    if (typeof Worker === "undefined")
        throw new Error("この環境では動く画像をGIFへ変換できません。originalを選んで保存してください。");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new Error("GIF変換後の画像が保存容量の上限を超えています。");
    return runSingleWorker({
        create: () => new Worker(new URL("../workers/animation-conversion-worker.js", import.meta.url), { type: "module" }),
        request: { blob, maxBytes: Math.min(maxBytes, MAX_IMAGE_BYTES) },
        signal, timeoutMs: 120_000,
        abortError: () => new DOMException("画像の変換を中止しました。", "AbortError"),
        timeoutError: () => new Error("GIFへの変換がタイムアウトしました。"),
        failureError: () => new Error("動く画像をGIFへ変換できませんでした。"),
        receive: (data, finish) => {
            if (!isAnimationConversionReply(data))
                finish(new Error("GIFへの変換結果が空です。"));
            else if (data.error)
                finish(new Error(data.error));
            else if (data.blob && data.blob.size > Math.min(maxBytes, MAX_IMAGE_BYTES))
                finish(new Error("GIF変換後の画像が保存容量の上限を超えています。"));
            else if (data.blob)
                finish(undefined, data.blob);
            else
                finish(new Error("GIFへの変換結果が空です。"));
        },
    });
}
