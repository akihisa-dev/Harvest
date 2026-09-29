import { fetchImage } from "./image-fetch.js";
import { decodeImage } from "./image-decode.js";
import { checkCancelled, invalidImage, validatePositiveInteger } from "./image-data-contract.js";
import { PdfImageError } from "./pdf-image-contract.js";
export { PdfImageError } from "./pdf-image-contract.js";
const DEFAULT_FETCH_CONCURRENCY = 3;
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
class ResultWindow {
    available;
    waiters = [];
    closed = false;
    closeError;
    constructor(capacity) {
        this.available = capacity;
    }
    acquire(signal) {
        checkCancelled(signal);
        if (this.closed)
            throw this.closeError ?? new Error("result window closed");
        if (this.available > 0) {
            this.available -= 1;
            return undefined;
        }
        return new Promise((resolve, reject) => {
            const waiter = {
                resolve: () => {
                    signal.removeEventListener("abort", abort);
                    resolve();
                },
                reject: (error) => {
                    signal.removeEventListener("abort", abort);
                    reject(error);
                },
                signal,
            };
            const abort = () => {
                const index = this.waiters.indexOf(waiter);
                if (index >= 0)
                    this.waiters.splice(index, 1);
                waiter.reject(new PdfImageError("cancelled", "画像の取得を中止しました。"));
            };
            waiter.abort = abort;
            this.waiters.push(waiter);
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted)
                abort();
        });
    }
    release() {
        if (this.closed)
            return;
        const waiter = this.waiters.shift();
        if (waiter)
            waiter.resolve();
        else
            this.available += 1;
    }
    close(error) {
        if (this.closed)
            return;
        this.closed = true;
        this.closeError = error;
        while (this.waiters.length)
            this.waiters.shift().reject(error ?? new Error("result window closed"));
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
    const resultWindow = new ResultWindow(Math.min(requestedConcurrency, items.length));
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
                resultWindow.close(error);
                throw error;
            }
            nextResult += 1;
            resultWindow.release();
        }
    };
    const worker = async () => {
        try {
            while (true) {
                const waiting = resultWindow.acquire(controller.signal);
                if (waiting)
                    await waiting;
                let transferred = false;
                try {
                    checkCancelled(controller.signal);
                    const index = nextIndex++;
                    if (index >= items.length)
                        return;
                    const item = items[index];
                    let fetched;
                    try {
                        fetched = await fetchImage(item.url, {
                            ...operationOptions,
                            ...(item.sourcePage === undefined ? {} : { sourcePage: item.sourcePage }),
                        });
                    }
                    catch (error) {
                        setResult(index, error instanceof PdfImageError ? error : new PdfImageError("network", "画像を取得できませんでした。通信状態と画像URLを確認してください。"));
                        transferred = true;
                        continue;
                    }
                    if (fetched.kind === "original") {
                        setResult(index, fetched.page);
                        transferred = true;
                        continue;
                    }
                    await queue.push({ ...fetched, index });
                    transferred = true;
                }
                finally {
                    if (!transferred)
                        resultWindow.release();
                }
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
