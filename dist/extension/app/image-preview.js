import { fetchImage } from "./image-fetch.js";
function entryKey(item) {
    return JSON.stringify([item.previewUrl ?? item.url, item.sourcePage]);
}
function previewBlob(item) {
    return item.kind === "bitmap" ? item.blob : new Blob([item.page.jpeg.slice().buffer], { type: "image/jpeg" });
}
/** Loads all remote previews through the shared, policy-controlled image fetcher. */
export function createImagePreviewLoader() {
    const maximumConcurrentFetches = 3;
    const retryDelayMs = 1_000;
    // Bound cached previews while keeping currently visible and eager images available.
    const maximumRetainedPreviews = 24;
    const entries = new Map();
    const bindings = new Map();
    const cachedEntries = new Map();
    const queue = [];
    let activeFetches = 0;
    let retainedPreviewCount = 0;
    const observer = typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(changes => {
            for (const change of changes) {
                const binding = bindings.get(change.target);
                const entry = binding ? entries.get(binding.key) : undefined;
                if (!binding || !entry)
                    continue;
                const wasPinned = isPinned(entry);
                binding.visible = change.isIntersecting;
                const isNowPinned = isPinned(entry);
                if (isNowPinned)
                    cachedEntries.delete(entry.key);
                else if (wasPinned && entry.objectUrl)
                    cache(entry);
                if (change.isIntersecting)
                    start(entry);
            }
        });
    function isPinned(entry) {
        for (const image of entry.elements) {
            const binding = bindings.get(image);
            if (binding?.visible || binding?.eager)
                return true;
        }
        return false;
    }
    function revoke(entry) {
        if (!entry.objectUrl)
            return;
        const objectUrl = entry.objectUrl;
        for (const image of entry.elements) {
            if (image.src === objectUrl)
                image.removeAttribute("src");
        }
        delete entry.objectUrl;
        retainedPreviewCount -= 1;
        URL.revokeObjectURL(objectUrl);
    }
    function enforceRetentionLimit() {
        while (retainedPreviewCount > maximumRetainedPreviews) {
            const oldest = cachedEntries.values().next().value;
            if (!oldest)
                return;
            cachedEntries.delete(oldest.key);
            revoke(oldest);
            oldest.started = false;
        }
    }
    function cache(entry) {
        if (!entry.objectUrl || isPinned(entry))
            return;
        cachedEntries.delete(entry.key);
        cachedEntries.set(entry.key, entry);
        enforceRetentionLimit();
    }
    function pumpQueue() {
        while (activeFetches < maximumConcurrentFetches && queue.length) {
            // Read live bindings so an already queued viewer image is promoted too.
            const eagerIndex = queue.findIndex(candidate => [...candidate.elements].some(image => bindings.get(image)?.eager));
            const entry = queue.splice(eagerIndex < 0 ? 0 : eagerIndex, 1)[0];
            entry.queued = false;
            if (entries.get(entry.key) !== entry || !entry.elements.size || (observer && !isPinned(entry)))
                continue;
            entry.started = true;
            activeFetches += 1;
            const options = { signal: entry.controller.signal, sourcePage: entry.item.sourcePage };
            void fetchImage(entry.item.previewUrl ?? entry.item.url, options).then(fetched => {
                if (entries.get(entry.key) !== entry || !entry.elements.size)
                    return;
                const objectUrl = URL.createObjectURL(previewBlob(fetched));
                entry.objectUrl = objectUrl;
                retainedPreviewCount += 1;
                for (const image of entry.elements) {
                    image.src = objectUrl;
                    image.dataset["previewUrl"] = entry.item.url;
                    delete image.dataset["previewFailed"];
                }
                if (isPinned(entry))
                    cachedEntries.delete(entry.key);
                else
                    cache(entry);
                enforceRetentionLimit();
            }).catch(() => {
                if (entries.get(entry.key) !== entry)
                    return;
                for (const image of entry.elements)
                    image.dataset["previewFailed"] = "true";
                entry.started = false;
                entry.retryAfter = Date.now() + retryDelayMs;
            }).finally(() => {
                activeFetches -= 1;
                pumpQueue();
            });
        }
    }
    function start(entry) {
        if (entry.started || entry.queued || entry.objectUrl || !entry.elements.size)
            return;
        if (Date.now() < entry.retryAfter)
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
        const entry = entries.get(binding.key);
        const wasPinned = entry ? isPinned(entry) : false;
        bindings.delete(image);
        delete image.dataset["previewUrl"];
        if (!entry)
            return;
        entry.elements.delete(image);
        if (entry.objectUrl && image.src === entry.objectUrl)
            image.removeAttribute("src");
        if (entry.elements.size) {
            if (wasPinned && !isPinned(entry) && entry.objectUrl)
                cache(entry);
            return;
        }
        entry.controller.abort();
        if (entry.queued) {
            const queueIndex = queue.indexOf(entry);
            if (queueIndex >= 0)
                queue.splice(queueIndex, 1);
            entry.queued = false;
        }
        cachedEntries.delete(entry.key);
        revoke(entry);
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
            if (item.kind === "video" && !item.previewUrl) {
                clearImage(image);
                image.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#ededed"/><path d="M140 60 L190 90 L140 120 Z" fill="#686868"/></svg>');
                image.dataset["previewUrl"] = item.url;
                return;
            }
            const key = entryKey(item);
            const current = bindings.get(image);
            if (current?.key === key) {
                const entry = entries.get(key);
                if (entry) {
                    const wasPinned = isPinned(entry);
                    current.eager = eager;
                    const isNowPinned = isPinned(entry);
                    if (isNowPinned)
                        cachedEntries.delete(entry.key);
                    else if (wasPinned && entry.objectUrl)
                        cache(entry);
                    if (eager)
                        start(entry);
                }
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
                entry = { key, item, controller: new AbortController(), elements: new Set(), started: false, queued: false, retryAfter: 0 };
                entries.set(key, entry);
            }
            entry.elements.add(image);
            bindings.set(image, { key, visible: false, eager });
            observer?.observe(image);
            if (entry.objectUrl) {
                image.src = entry.objectUrl;
                if (isPinned(entry))
                    cachedEntries.delete(entry.key);
            }
            else if (eager || !observer)
                start(entry);
        },
        clearImage,
        clear() {
            for (const image of [...bindings.keys()])
                clearImage(image);
            for (const entry of entries.values()) {
                entry.controller.abort();
                cachedEntries.delete(entry.key);
                revoke(entry);
            }
            entries.clear();
            cachedEntries.clear();
        },
    };
}
