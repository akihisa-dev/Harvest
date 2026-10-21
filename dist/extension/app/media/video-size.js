import { formatFileSize } from "../../core/file-size.js";
import { fetchResponse } from "./response-fetch.js";
const errors = {
    http: () => new Error("Video size unavailable"),
    cancelled: () => new Error("Video size cancelled"),
    timeout: () => new Error("Video size timed out"),
    failure: error => error,
};
export async function fetchVideoSize(item, signal) {
    if (item.youtube)
        return item.youtube.bytes ?? null;
    if (item.stream)
        return item.stream.bytes ?? null;
    return fetchResponse(item.url, { sourcePage: item.sourcePage, fetchSourcePage: item.fetchSourcePage, ...(signal ? { signal } : {}), method: "HEAD", timeoutMs: 10000 }, errors, async (response) => {
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
    const pending = new Map();
    let active = 0;
    function pump() {
        while (active < 3 && pending.size) {
            const [element, entry] = pending.entries().next().value;
            pending.delete(element);
            active += 1;
            void fetchVideoSize(entry.item, entry.controller.signal).catch(() => null).then(size => {
                if (entries.get(element) !== entry)
                    return;
                const sizeLabel = size === null ? labels.unknown : formatFileSize(size);
                element.textContent = entry.item.youtube ? `${entry.item.youtube.quality} · ${sizeLabel}` : sizeLabel;
            }).finally(() => { active -= 1; pump(); });
        }
    }
    function release(element) {
        entries.get(element)?.controller.abort();
        pending.delete(element);
        entries.delete(element);
    }
    return {
        set(element, item) {
            const current = entries.get(element);
            if (current?.item.url === item.url && current.item.sourcePage === item.sourcePage && current.item.fetchSourcePage === item.fetchSourcePage)
                return;
            release(element);
            element.hidden = false;
            element.textContent = labels.loading;
            const entry = { item, controller: new AbortController() };
            entries.set(element, entry);
            pending.set(element, entry);
            pump();
        },
        release,
        clear() { for (const element of entries.keys())
            release(element); },
    };
}
