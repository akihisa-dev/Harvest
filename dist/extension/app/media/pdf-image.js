import { createPreparationWorkers } from "../../core/preparation-workers.js";
import { fetchImage } from "./image-fetch.js";
import { decodeImage } from "./image-decode.js";
import { checkCancelled, invalidImage, validatePositiveInteger } from "../contracts/image-data-contract.js";
import { PdfImageError } from "../contracts/pdf-image-contract.js";
export { PdfImageError } from "../contracts/pdf-image-contract.js";
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
    const queue = new BoundedQueue(1);
    const results = new Array(items.length);
    let nextResult = 0;
    let callbackFailed = false;
    let callbackError;
    const setResult = (index, result, release) => {
        if (callbackFailed)
            throw callbackError;
        results[index] = { result, release };
        while (nextResult < items.length) {
            const current = results[nextResult];
            if (current === undefined)
                break;
            results[nextResult] = undefined;
            try {
                onResult(items[nextResult], current.result);
            }
            catch (error) {
                callbackFailed = true;
                callbackError = error;
                workers.fail(error);
                throw error;
            }
            nextResult += 1;
            current.release();
        }
    };
    const workers = createPreparationWorkers(items.length, requestedConcurrency, options.signal, async (index, signal, release) => {
        const item = items[index];
        let fetched;
        try {
            fetched = await fetchImage(item.url, {
                ...options, signal,
                ...(item.sourcePage === undefined ? {} : { sourcePage: item.sourcePage }),
            });
        }
        catch (error) {
            setResult(index, error instanceof PdfImageError ? error : new PdfImageError("network", "画像を取得できませんでした。通信状態と画像URLを確認してください。"), release);
            return;
        }
        if (fetched.kind === "original") {
            setResult(index, fetched.page, release);
            return;
        }
        await queue.push({ ...fetched, index, release });
    });
    const closeQueue = () => queue.close(workers.signal.reason);
    workers.signal.addEventListener("abort", closeQueue, { once: true });
    if (workers.signal.aborted)
        closeQueue();
    const fetchCompletion = workers.finished.then(() => queue.close(), error => {
        queue.close(error);
        throw error;
    });
    const converter = (async () => {
        while (true) {
            const queued = await queue.pop();
            if (queued === null)
                return;
            let result;
            try {
                result = await decodeImage(queued, { ...options, signal: workers.signal });
            }
            catch (error) {
                result = error instanceof PdfImageError ? error : invalidImage("画像をPDF用に変換できませんでした。");
            }
            setResult(queued.index, result, queued.release);
        }
    })();
    const outcomes = await Promise.allSettled([fetchCompletion, converter]);
    workers.signal.removeEventListener("abort", closeQueue);
    workers.dispose();
    if (callbackFailed)
        throw callbackError;
    checkCancelled(workers.signal);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    if (rejected)
        throw rejected.reason;
}
