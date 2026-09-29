import { getOriginalJpegPage } from "../core/jpeg.js";
import { checkCancelled, invalidImage, ImageDataError } from "./image-data-contract.js";
const DEFAULT_TIMEOUT_MS = 20_000;
function timeoutValue(options) {
    const value = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError("timeoutMs must be a positive finite number.");
    }
    return value;
}
function responseError(status) {
    if (status === 401 || status === 403) {
        return new ImageDataError("http", "画像へのアクセスが拒否されました。", status);
    }
    if (status === 404 || status === 410) {
        return new ImageDataError("http", "画像が見つかりませんでした。", status);
    }
    if (status === 408 || status === 429 || status >= 500) {
        return new ImageDataError("http", "画像サーバーが応答できませんでした。", status);
    }
    return new ImageDataError("http", "画像を取得できませんでした。", status);
}
function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError";
}
async function cancelResponse(response) {
    try {
        if (response?.body && !response.bodyUsed)
            await response.body.cancel();
    }
    catch {
        // A response that has already been closed needs no further cleanup.
    }
}
export async function fetchImage(url, options) {
    checkCancelled(options.signal);
    const timeoutMs = timeoutValue(options);
    const controller = new AbortController();
    let response;
    let timedOut = false;
    let timeoutHandle;
    let removeAbortListener;
    const sourceSignal = options.signal;
    let rejectAbort;
    const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
    if (sourceSignal?.aborted)
        controller.abort();
    else if (sourceSignal) {
        const abort = () => {
            controller.abort();
            rejectAbort?.(new ImageDataError("cancelled", "画像の取得を中止しました。"));
        };
        sourceSignal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => sourceSignal.removeEventListener("abort", abort);
    }
    const operation = (async () => {
        try {
            response = await fetch(url, { credentials: "include", signal: controller.signal });
            if (!response.ok) {
                const error = responseError(response.status);
                void cancelResponse(response);
                throw error;
            }
            const contentType = response.headers.get("content-type") ?? "";
            if (contentType && !contentType.toLowerCase().startsWith("image/")) {
                throw invalidImage("画像データではありません。");
            }
            // Keep one response buffer for JPEG detection and direct PDF embedding.
            // Only formats requiring pixel decoding need a Blob afterward.
            const bytes = new Uint8Array(await response.arrayBuffer());
            const original = getOriginalJpegPage(bytes);
            if (original)
                return { kind: "original", page: original };
            return { kind: "bitmap", blob: new Blob([bytes], { type: contentType }) };
        }
        catch (error) {
            void cancelResponse(response);
            if (error instanceof ImageDataError)
                throw error;
            if (sourceSignal?.aborted) {
                throw new ImageDataError("cancelled", "画像の取得を中止しました。");
            }
            if (controller.signal.aborted || isAbortError(error)) {
                // The timeout promise below wins the race when it caused the abort.
                throw new ImageDataError("timeout", "画像の取得に時間がかかりすぎたため中止しました。");
            }
            throw new ImageDataError("network", "画像を取得できませんでした。通信状態と画像URLを確認してください。");
        }
    })();
    const timeout = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            timedOut = true;
            controller.abort();
            void cancelResponse(response);
            reject(new ImageDataError("timeout", "画像の取得に時間がかかりすぎたため中止しました。"));
        }, timeoutMs);
    });
    try {
        return await Promise.race([operation, timeout, cancelled]);
    }
    catch (error) {
        if (timedOut) {
            throw new ImageDataError("timeout", "画像の取得に時間がかかりすぎたため中止しました。");
        }
        throw error;
    }
    finally {
        if (timeoutHandle !== undefined)
            clearTimeout(timeoutHandle);
        removeAbortListener?.();
        if (timedOut)
            void cancelResponse(response);
    }
}
