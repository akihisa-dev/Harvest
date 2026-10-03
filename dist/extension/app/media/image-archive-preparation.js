import { isMediaArchiveFormat } from "../../core/export-formats.js";
import { ImageArchiveLimitError, ImageArchivePlan } from "../../core/image-archive.js";
import { createPreparationWorkers, waitForPreparation } from "../../core/preparation-workers.js";
import { fetchImage } from "./image-fetch.js";
import { convertImage } from "./image-format.js";
import { fetchOriginalMedia } from "./media-fetch.js";
import { prepareMp4 } from "./mp4-conversion.js";
const IMAGE_FETCH_CONCURRENCY = 3;
function createDeferred() {
    let resolve;
    const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}
/** Fetches within a bounded window, converts in input order, and retains only retryable results. */
export async function prepareImageArchive(work, options) {
    const { format } = work;
    const remaining = work.selected.filter(item => !work.prepared.has(item));
    const plan = new ImageArchivePlan(work.selected, work.prepared, format);
    work.failed.clear();
    const isOriginalMedia = isMediaArchiveFormat(format);
    // Allow the save button's immediate cancellation before starting any prefetch.
    await Promise.resolve();
    if (options.isStopped())
        return null;
    const fetchedResults = remaining.map(() => createDeferred());
    const workers = createPreparationWorkers(remaining.length, isOriginalMedia ? 1 : IMAGE_FETCH_CONCURRENCY, options.signal, async (index, signal, release) => {
        const item = remaining[index];
        let outcome;
        try {
            outcome = {
                ok: true,
                fetched: isOriginalMedia
                    ? await fetchOriginalMedia(item.url, item.kind ?? "image", { signal, sourcePage: item.sourcePage })
                    : await fetchImage(item.url, { signal, sourcePage: item.sourcePage }),
            };
        }
        catch (error) {
            outcome = { ok: false, error };
        }
        fetchedResults[index].resolve({ ...outcome, release });
    });
    // Observe failures while the consumer waits for the next result in input order.
    const fetchCompletion = Promise.allSettled([workers.finished]);
    try {
        for (let index = 0; index < remaining.length; index += 1) {
            if (options.isStopped())
                return null;
            const outcome = await waitForPreparation(fetchedResults[index].promise, workers.signal);
            if (options.isStopped())
                return null;
            const item = remaining[index];
            try {
                if (!outcome.ok)
                    throw outcome.error;
                let blob = isOriginalMedia
                    ? outcome.fetched
                    : await convertImage(outcome.fetched, format, options.signal);
                if (format === "mp4")
                    blob = await prepareMp4(blob, options.signal, plan.remainingBytes);
                if (options.isStopped())
                    return null;
                plan.retain(item, blob);
            }
            catch (error) {
                if (options.isStopped())
                    return null;
                if (error instanceof ImageArchiveLimitError)
                    throw error;
                work.failed.set(item, error instanceof Error ? error.message : options.fallbackFailure);
            }
            finally {
                fetchedResults[index] = undefined;
                outcome.release();
            }
            options.onProgress(index + 1, remaining.length);
        }
    }
    finally {
        workers.abort();
        await fetchCompletion;
    }
    if (options.isStopped() || work.failed.size)
        return null;
    return plan.entries();
}
