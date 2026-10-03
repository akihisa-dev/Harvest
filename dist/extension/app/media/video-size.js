import { formatFileSize } from "../../core/file-size.js";
import { fetchResponse } from "./response-fetch.js";
const errors = {
    http: () => new Error("Video size unavailable"),
    cancelled: () => new Error("Video size cancelled"),
    timeout: () => new Error("Video size timed out"),
    failure: error => error,
};
export async function fetchVideoSize(item, signal) {
    return fetchResponse(item.url, { sourcePage: item.sourcePage, ...(signal ? { signal } : {}), method: "HEAD", timeoutMs: 10000 }, errors, async (response) => {
        const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        const encoding = response.headers.get("content-encoding");
        if (type && !type.startsWith("video/") && type !== "application/octet-stream")
            return null;
        if (encoding && encoding !== "identity")
            return null;
        const value = response.headers.get("content-length");
        if (response.status !== 200 || !value || !/^\d+$/.test(value))
            return null;
        const bytes = Number(value);
        return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
    });
}
/** Bound requests and retain metadata only while the thumbnail row exists. */
export function createVideoSizeLoader(labels) {
    const entries = new Map();
    let active = 0;
    function pump() {
        for (const [element, entry] of entries) {
            if (active >= 3)
                break;
            if (entry.started)
                continue;
            entry.started = true;
            active += 1;
            void fetchVideoSize(entry.item, entry.controller.signal).catch(() => null).then(size => {
                if (entries.get(element) !== entry)
                    return;
                element.textContent = size === null ? labels.unknown : formatFileSize(size);
            }).finally(() => { active -= 1; pump(); });
        }
    }
    function release(element) {
        entries.get(element)?.controller.abort();
        entries.delete(element);
    }
    return {
        set(element, item) {
            const current = entries.get(element);
            if (current?.item.url === item.url && current.item.sourcePage === item.sourcePage)
                return;
            release(element);
            element.hidden = false;
            element.textContent = labels.loading;
            entries.set(element, { item, controller: new AbortController(), started: false });
            pump();
        },
        release,
        clear() { for (const element of entries.keys())
            release(element); },
    };
}
