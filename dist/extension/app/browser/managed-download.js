import { streamDownloadUrl } from "../../core/stream-recording.js";
import { inspectStreamRecording, streamAccessError } from "./stream-recording.js";
export async function downloadManagedBlob(blob, filename, signal) {
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    try {
        await downloadManagedUrl(url, filename, signal);
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
/** Chrome streams the authorized original to disk; no Blob or file-size/time ceiling. */
export async function downloadManagedRecording(recording, filename, signal, onProgress) {
    const current = await inspectStreamRecording(recording.pageUrl, signal);
    const url = streamDownloadUrl(current.pageUrl);
    await downloadManagedUrl(url, filename, signal, async (id) => {
        const [item] = await chrome.downloads.search({ id });
        // An expired login can return a successful HTML download. Never call that a saved recording.
        if (!item || !["video/mp4", "application/octet-stream"].includes(item.mime?.toLowerCase() ?? "")
            || !(item.fileSize && item.fileSize > 0) || (current.bytes !== undefined && current.bytes !== item.fileSize))
            throw new Error(streamAccessError);
    }, onProgress, current.bytes);
}
/** Tracks only the ID returned by this save; never queries the user's download history. */
async function downloadManagedUrl(url, filename, signal, verify, onProgress, expectedBytes) {
    signal.throwIfAborted();
    let id;
    let finished = false;
    let progressTimer;
    const stopPolling = () => { clearTimeout(progressTimer); progressTimer = undefined; };
    let resolve;
    let reject;
    const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Observe rejection while download() / search() are still pending.
    void completion.catch(() => { });
    const fail = (error) => { if (!finished) {
        finished = true;
        stopPolling();
        reject(error);
    } };
    const update = (state, error) => {
        if (finished)
            return;
        if (state === "complete") {
            finished = true;
            stopPolling();
            resolve();
        }
        else if (state === "interrupted")
            fail(new Error(error ?? "Download interrupted"));
    };
    const listener = delta => {
        if (id !== undefined && delta.id === id)
            update(delta.state?.current, delta.error?.current);
    };
    const inspect = async () => {
        if (id === undefined || finished || signal.aborted)
            return;
        const [item] = await chrome.downloads.search({ id });
        // A pending query must never publish progress after cancellation/completion.
        if (finished || signal.aborted)
            return;
        if (!item) {
            fail(new Error("Download unavailable"));
            return;
        }
        update(item.state, item.error);
        const total = item.totalBytes !== undefined && Number.isFinite(item.totalBytes) && item.totalBytes > 0 ? item.totalBytes : expectedBytes;
        if (!finished && total !== undefined && total > 0 && item.bytesReceived !== undefined && Number.isFinite(item.bytesReceived) && item.bytesReceived >= 0) {
            onProgress?.(Math.min(1, item.bytesReceived / total));
        }
    };
    const scheduleProgress = () => {
        if (!onProgress || finished || signal.aborted)
            return;
        progressTimer = setTimeout(() => {
            progressTimer = undefined;
            void inspect().then(scheduleProgress).catch(error => {
                if (!finished && !signal.aborted)
                    fail(error instanceof Error ? error : new Error("Download unavailable"));
            });
        }, 250);
    };
    const abort = () => {
        stopPolling();
        // If Chrome already reported completion, do not cancel a completed file.
        if (finished)
            return;
        if (id === undefined)
            return;
        const ownId = id;
        void (async () => {
            try {
                await chrome.downloads.cancel(ownId);
                const [item] = await chrome.downloads.search({ id: ownId });
                if (item)
                    update(item.state, item.error);
                else
                    fail(new Error("Download unavailable"));
            }
            catch (error) {
                // Chrome may reject cancellation because the file completed before our ID arrived.
                try {
                    const [item] = await chrome.downloads.search({ id: ownId });
                    if (item)
                        update(item.state, item.error);
                }
                catch { /* Preserve the cancellation error if state cannot be observed. */ }
                fail(error instanceof Error ? error : new Error("Download cancellation failed"));
            }
        })();
    };
    try {
        chrome.downloads.onChanged.addListener(listener);
        signal.addEventListener("abort", abort, { once: true });
        id = await chrome.downloads.download({ url, filename, conflictAction: "uniquify" });
        // Cancellation can precede the download ID (e.g. while Chrome awaits a choice).
        if (signal.aborted) {
            abort();
        }
        else {
            // An event can precede download() resolving. Query just our ID to close that race.
            await inspect();
            scheduleProgress();
        }
        await completion;
        await verify?.(id);
    }
    finally {
        stopPolling();
        signal.removeEventListener("abort", abort);
        chrome.downloads.onChanged.removeListener(listener);
    }
}
