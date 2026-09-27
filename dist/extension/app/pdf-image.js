import { getOriginalJpegPage } from "../core/pdf.js";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_FETCH_CONCURRENCY = 3;
const DEFAULT_PIXEL_CHUNK_PIXELS = 262_144;
/** A user-safe reason for an image that could not be included in the PDF. */
export class PdfImageError extends Error {
    kind;
    status;
    constructor(kind, message, status) {
        super(message);
        this.name = "PdfImageError";
        this.kind = kind;
        if (status !== undefined)
            this.status = status;
    }
}
function invalidImage(message) {
    return new PdfImageError("invalid-image", message);
}
function validatePositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer.`);
    }
    return value;
}
function timeoutValue(options) {
    const value = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError("timeoutMs must be a positive finite number.");
    }
    return value;
}
function responseError(status) {
    if (status === 401 || status === 403) {
        return new PdfImageError("http", "画像へのアクセスが拒否されました。", status);
    }
    if (status === 404 || status === 410) {
        return new PdfImageError("http", "画像が見つかりませんでした。", status);
    }
    if (status === 408 || status === 429 || status >= 500) {
        return new PdfImageError("http", "画像サーバーが応答できませんでした。", status);
    }
    return new PdfImageError("http", "画像を取得できませんでした。", status);
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
function checkCancelled(signal) {
    if (signal?.aborted)
        throw new PdfImageError("cancelled", "画像の取得を中止しました。");
}
async function fetchImage(url, options) {
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
            rejectAbort?.(new PdfImageError("cancelled", "画像の取得を中止しました。"));
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
            const blob = await response.blob();
            if (blob.type && !blob.type.toLowerCase().startsWith("image/")) {
                throw invalidImage("画像データではありません。");
            }
            // Read the body while the response timeout is still active. This also lets
            // us detect and retain a supported JPEG without decoding or re-encoding it.
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const original = getOriginalJpegPage(bytes);
            if (original)
                return { kind: "original", page: original };
            return { kind: "bitmap", blob };
        }
        catch (error) {
            void cancelResponse(response);
            if (error instanceof PdfImageError)
                throw error;
            if (sourceSignal?.aborted) {
                throw new PdfImageError("cancelled", "画像の取得を中止しました。");
            }
            if (controller.signal.aborted || isAbortError(error)) {
                // The timeout promise below wins the race when it caused the abort.
                throw new PdfImageError("timeout", "画像の取得に時間がかかりすぎたため中止しました。");
            }
            throw new PdfImageError("network", "画像を取得できませんでした。通信状態と画像URLを確認してください。");
        }
    })();
    const timeout = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            timedOut = true;
            controller.abort();
            void cancelResponse(response);
            reject(new PdfImageError("timeout", "画像の取得に時間がかかりすぎたため中止しました。"));
        }, timeoutMs);
    });
    try {
        return await Promise.race([operation, timeout, cancelled]);
    }
    catch (error) {
        if (timedOut) {
            throw new PdfImageError("timeout", "画像の取得に時間がかかりすぎたため中止しました。");
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
function yieldToEventLoop() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
async function decodeImage(fetched, options) {
    checkCancelled(options.signal);
    if (fetched.kind === "original")
        return fetched.page;
    let bitmap;
    try {
        bitmap = await createImageBitmap(fetched.blob);
    }
    catch {
        throw invalidImage("画像を読み込めませんでした。形式が対応していないか、データが壊れています。");
    }
    let canvas;
    try {
        checkCancelled(options.signal);
        const width = bitmap.width;
        const height = bitmap.height;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
            throw invalidImage("画像の大きさが不正です。");
        }
        const pixelCount = width * height;
        if (!Number.isSafeInteger(pixelCount) || pixelCount > Number.MAX_SAFE_INTEGER / 3) {
            throw invalidImage("画像が大きすぎてPDF用に変換できませんでした。");
        }
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        if (canvas.width !== width || canvas.height !== height) {
            throw invalidImage("画像が大きすぎてPDF用に変換できませんでした。");
        }
        const context = canvas.getContext("2d");
        if (!context)
            throw invalidImage("画像をPDF用に変換できませんでした。");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0);
        const rgb = new Uint8Array(pixelCount * 3);
        const requestedRows = options.pixelRowsPerChunk;
        if (requestedRows !== undefined)
            validatePositiveInteger(requestedRows, "pixelRowsPerChunk");
        const rowsPerChunk = requestedRows ?? Math.max(1, Math.floor(DEFAULT_PIXEL_CHUNK_PIXELS / width));
        for (let y = 0; y < height; y += rowsPerChunk) {
            checkCancelled(options.signal);
            const rows = Math.min(rowsPerChunk, height - y);
            let pixels;
            try {
                pixels = context.getImageData(0, y, width, rows).data;
            }
            catch {
                throw invalidImage("画像をPDF用に変換できませんでした。");
            }
            const expectedLength = width * rows * 4;
            if (pixels.length < expectedLength) {
                throw invalidImage("画像をPDF用に変換できませんでした。");
            }
            const start = y * width * 3;
            for (let source = 0, target = start; source < expectedLength; source += 4) {
                rgb[target++] = pixels[source] ?? 0;
                rgb[target++] = pixels[source + 1] ?? 0;
                rgb[target++] = pixels[source + 2] ?? 0;
            }
            if (y + rows < height)
                await yieldToEventLoop();
        }
        try {
            const stream = new Blob([rgb.buffer]).stream().pipeThrough(new CompressionStream("deflate"));
            const rgbFlate = new Uint8Array(await new Response(stream).arrayBuffer());
            return { rgbFlate, width, height };
        }
        catch {
            throw invalidImage("画像をPDF用に変換できませんでした。");
        }
    }
    finally {
        bitmap.close();
        // Release the browser's backing store as soon as the compressed page exists.
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
}
/**
 * Fetches and converts one image. Existing callers can continue using this
 * helper; options are optional so the old API remains source compatible.
 */
export async function toPdfPage(imageUrl, options = {}) {
    const fetched = await fetchImage(imageUrl, options);
    try {
        return await decodeImage(fetched, options);
    }
    catch (error) {
        if (error instanceof PdfImageError)
            throw error;
        throw invalidImage("画像をPDF用に変換できませんでした。");
    }
}
class BoundedQueue {
    capacity;
    values = [];
    readers = [];
    writers = [];
    closed = false;
    closeError;
    constructor(capacity) {
        this.capacity = capacity;
    }
    async push(value) {
        if (this.closed)
            throw this.closeError ?? new Error("queue closed");
        const reader = this.readers.shift();
        if (reader) {
            reader(value);
            return;
        }
        if (this.values.length < this.capacity) {
            this.values.push(value);
            return;
        }
        await new Promise((resolve, reject) => this.writers.push({ value, resolve, reject }));
    }
    async pop() {
        const value = this.values.shift();
        if (value !== undefined) {
            this.releaseWriter();
            return value;
        }
        const writer = this.writers.shift();
        if (writer) {
            writer.resolve();
            return writer.value;
        }
        if (this.closed)
            return null;
        return new Promise((resolve) => this.readers.push(resolve));
    }
    close(error) {
        if (this.closed)
            return;
        this.closed = true;
        this.closeError = error;
        while (this.readers.length)
            this.readers.shift()(null);
        while (this.writers.length)
            this.writers.shift().reject(error ?? new Error("queue closed"));
    }
    releaseWriter() {
        const writer = this.writers.shift();
        if (!writer)
            return;
        const reader = this.readers.shift();
        if (reader)
            reader(writer.value);
        else
            this.values.push(writer.value);
        writer.resolve();
    }
}
/**
 * Prepares images with a small network concurrency limit and one pixel
 * conversion at a time. Results are delivered in input order, so callers can
 * retain successful pages and retry only the items reported as errors.
 */
export async function preparePdfImages(items, onResult, options = {}) {
    const requestedConcurrency = options.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY;
    validatePositiveInteger(requestedConcurrency, "fetchConcurrency");
    if (items.length === 0)
        return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted)
        controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const operationOptions = { ...options, signal: controller.signal };
    const queue = new BoundedQueue(1);
    const results = new Array(items.length);
    let nextIndex = 0;
    let nextResult = 0;
    let workersFinished = 0;
    const workerCount = Math.min(requestedConcurrency, items.length);
    let callbackError;
    const setResult = (index, result) => {
        if (callbackError !== undefined)
            throw callbackError;
        results[index] = result;
        while (nextResult < items.length) {
            const current = results[nextResult];
            if (current === undefined)
                break;
            results[nextResult] = undefined;
            try {
                onResult(items[nextResult], current);
            }
            catch (error) {
                callbackError = error;
                controller.abort();
                queue.close(error);
                throw error;
            }
            nextResult += 1;
        }
    };
    const worker = async () => {
        try {
            while (true) {
                checkCancelled(controller.signal);
                const index = nextIndex++;
                if (index >= items.length)
                    return;
                const item = items[index];
                let fetched;
                try {
                    fetched = await fetchImage(item.url, operationOptions);
                }
                catch (error) {
                    setResult(index, error instanceof PdfImageError ? error : new PdfImageError("network", "画像を取得できませんでした。通信状態と画像URLを確認してください。"));
                    continue;
                }
                if (fetched.kind === "original") {
                    setResult(index, fetched.page);
                    continue;
                }
                await queue.push({ ...fetched, index });
            }
        }
        finally {
            workersFinished += 1;
            if (workersFinished === workerCount)
                queue.close();
        }
    };
    const workers = Array.from({ length: workerCount }, () => worker());
    const converter = (async () => {
        while (true) {
            const queued = await queue.pop();
            if (queued === null)
                return;
            let result;
            try {
                result = await decodeImage(queued, operationOptions);
            }
            catch (error) {
                result = error instanceof PdfImageError ? error : invalidImage("画像をPDF用に変換できませんでした。");
            }
            setResult(queued.index, result);
        }
    })();
    const outcomes = await Promise.allSettled([...workers, converter]);
    options.signal?.removeEventListener("abort", abort);
    if (callbackError !== undefined)
        throw callbackError;
    checkCancelled(controller.signal);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    if (rejected)
        throw rejected.reason;
}
