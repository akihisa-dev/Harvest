/** Tracks only the ID returned by this save; never queries the user's download history. */
export async function downloadManagedBlob(blob, filename, signal) {
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    let id;
    let finished = false;
    let resolve;
    let reject;
    const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Observe rejection while download() / search() are still pending.
    void completion.catch(() => { });
    const fail = (error) => { if (!finished) {
        finished = true;
        reject(error);
    } };
    const update = (state, error) => {
        if (finished)
            return;
        if (state === "complete") {
            finished = true;
            resolve();
        }
        else if (state === "interrupted")
            fail(new Error(error ?? "Download interrupted"));
    };
    const listener = delta => {
        if (id !== undefined && delta.id === id)
            update(delta.state?.current, delta.error?.current);
    };
    const abort = () => {
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
            const [item] = await chrome.downloads.search({ id });
            if (item)
                update(item.state, item.error);
            else
                fail(new Error("Download unavailable"));
        }
        await completion;
    }
    finally {
        signal.removeEventListener("abort", abort);
        chrome.downloads.onChanged.removeListener(listener);
        URL.revokeObjectURL(url);
    }
}
