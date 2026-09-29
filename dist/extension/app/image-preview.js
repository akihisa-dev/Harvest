import { fetchImage } from "./image-fetch.js";
function entryKey(item) {
    return JSON.stringify([item.url, item.sourcePage]);
}
function previewBlob(item) {
    return item.kind === "bitmap" ? item.blob : new Blob([item.page.jpeg.slice().buffer], { type: "image/jpeg" });
}
/** Loads all remote previews through the shared, policy-controlled image fetcher. */
export function createImagePreviewLoader() {
    const maximumConcurrentFetches = 3;
    const entries = new Map();
    const bindings = new Map();
    const queue = [];
    let activeFetches = 0;
    const observer = typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(changes => {
            for (const change of changes) {
                if (!change.isIntersecting)
                    continue;
                const key = bindings.get(change.target)?.key;
                const entry = key ? entries.get(key) : undefined;
                if (entry)
                    start(entry);
            }
        });
    function pumpQueue() {
        while (activeFetches < maximumConcurrentFetches && queue.length) {
            const entry = queue.shift();
            entry.queued = false;
            if (entries.get(entry.key) !== entry || !entry.elements.size)
                continue;
            entry.started = true;
            activeFetches += 1;
            const options = { signal: entry.controller.signal, sourcePage: entry.item.sourcePage };
            void fetchImage(entry.item.url, options).then(fetched => {
                if (entries.get(entry.key) !== entry || !entry.elements.size)
                    return;
                const objectUrl = URL.createObjectURL(previewBlob(fetched));
                entry.objectUrl = objectUrl;
                for (const image of entry.elements) {
                    image.src = objectUrl;
                    image.dataset["previewUrl"] = entry.item.url;
                    delete image.dataset["previewFailed"];
                }
            }).catch(() => {
                if (entries.get(entry.key) !== entry)
                    return;
                for (const image of entry.elements)
                    image.dataset["previewFailed"] = "true";
            }).finally(() => {
                activeFetches -= 1;
                pumpQueue();
            });
        }
    }
    function start(entry) {
        if (entry.started || entry.queued || entry.objectUrl || !entry.elements.size)
            return;
        entry.queued = true;
        queue.push(entry);
        pumpQueue();
    }
    function release(image) {
        observer?.unobserve(image);
        const binding = bindings.get(image);
        if (!binding)
            return;
        bindings.delete(image);
        delete image.dataset["previewUrl"];
        const entry = entries.get(binding.key);
        if (!entry)
            return;
        entry.elements.delete(image);
        if (entry.objectUrl && image.src === entry.objectUrl)
            image.removeAttribute("src");
        if (entry.elements.size)
            return;
        entry.controller.abort();
        if (entry.queued) {
            const queueIndex = queue.indexOf(entry);
            if (queueIndex >= 0)
                queue.splice(queueIndex, 1);
            entry.queued = false;
        }
        if (entry.objectUrl)
            URL.revokeObjectURL(entry.objectUrl);
        entries.delete(entry.key);
    }
    function clearImage(image) {
        release(image);
        image.removeAttribute("src");
        delete image.dataset["previewUrl"];
        delete image.dataset["previewFailed"];
    }
    return {
        set(image, item, eager = false) {
            const key = entryKey(item);
            const current = bindings.get(image);
            if (current?.key === key) {
                const entry = entries.get(key);
                if (eager && entry)
                    start(entry);
                return;
            }
            release(image);
            delete image.dataset["previewFailed"];
            if (item.url.startsWith("data:")) {
                if (image.getAttribute("src") !== item.url)
                    image.src = item.url;
                image.dataset["previewUrl"] = item.url;
                return;
            }
            image.removeAttribute("src");
            image.dataset["previewUrl"] = item.url;
            image.loading = "lazy";
            let entry = entries.get(key);
            if (!entry) {
                entry = { key, item, controller: new AbortController(), elements: new Set(), started: false, queued: false };
                entries.set(key, entry);
            }
            entry.elements.add(image);
            bindings.set(image, { key });
            if (entry.objectUrl)
                image.src = entry.objectUrl;
            else if (eager || !observer)
                start(entry);
            else
                observer?.observe(image);
        },
        clearImage,
        clear() {
            for (const image of [...bindings.keys()])
                clearImage(image);
            for (const entry of entries.values()) {
                entry.controller.abort();
                if (entry.objectUrl)
                    URL.revokeObjectURL(entry.objectUrl);
            }
            entries.clear();
        },
    };
}
