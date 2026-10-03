/** Runs at document_start in MAIN; retains only media evidence in this document. */
export function installXBookmarkCapture() {
    const bridge = "__harvestBookmarkMediaV1";
    if (Object.getOwnPropertyDescriptor(window, bridge))
        return;
    const bookmarkPage = () => /^\/i\/(?:history|bookmarks)\/?$/.test(location.pathname);
    // Retained evidence and its generation are changed atomically. Request
    // classification owns a separate scope so pending body reads can be invalidated.
    const capture = (() => {
        const posts = new Map();
        let generation = 0, epoch = 0, failed = false, received = false;
        const clear = () => {
            posts.clear();
            epoch++;
            delete window["__harvestBookmarkScanMemoryV1"];
        };
        return {
            clear,
            reset() { clear(); generation++; failed = false; received = false; },
            fail() { failed = true; },
            receive() { received = true; },
            generation() { return generation; },
            accepts(token) { return token !== undefined && token === generation; },
            add(id, post) { posts.set(id, post); },
            snapshot() {
                return bookmarkPage() ? { posts: [...posts.values()], limited: failed, received, epoch }
                    : { posts: [], limited: false, received: false, epoch };
            },
        };
    })();
    const record = (input) => input !== null && typeof input === "object" && !Array.isArray(input) ? input : undefined;
    const fields = ["__typename", "rest_id", "id_str", "media_key", "type", "media_url_https", "media_url",
        "thumbnail_url", "preview_image_url", "content_type", "bitrate", "url", "tweet", "result", "legacy",
        "extended_entities", "entities", "media", "mediaDetails", "video_info", "variants",
        "quoted_status_result", "retweeted_status_result", "quoted_status", "retweeted_status"];
    const project = (input, depth = 0) => {
        if (depth > 24) {
            capture.fail();
            return undefined;
        }
        if (typeof input === "string")
            return input.length <= 8192 ? input : undefined;
        if (typeof input === "number" || typeof input === "boolean")
            return input;
        if (Array.isArray(input))
            return input.map(item => project(item, depth + 1));
        const obj = record(input);
        if (!obj)
            return undefined;
        const output = {};
        for (const key of fields) {
            const raw = Object.getOwnPropertyDescriptor(obj, key);
            if (raw && "value" in raw)
                output[key] = project(raw.value, depth + 1);
        }
        return output;
    };
    const ingest = (input, token) => {
        requests.syncPage();
        if (!capture.accepts(token) || !bookmarkPage())
            return;
        const data = record(record(input)?.["data"]);
        const timeline = record(record(data?.["bookmark_timeline_v2"])?.["timeline"]);
        const instructions = timeline?.["instructions"];
        if (!Array.isArray(instructions)) {
            capture.fail();
            return;
        }
        capture.receive();
        const addItem = (input) => {
            const item = record(input);
            const result = record(record(item?.["tweet_results"])?.["result"]);
            const tweet = record(result?.["tweet"]) ?? result;
            const legacy = record(tweet?.["legacy"]);
            const id = tweet?.["rest_id"] ?? legacy?.["id_str"];
            if (typeof id !== "string" || !/^\d+$/.test(id))
                return;
            capture.add(id, { key: `post:${id}`, postId: id, observed: [],
                roots: [{ value: project(result), requireIdentity: true, player: false }] });
        };
        for (const instruction of instructions) {
            const row = record(instruction);
            if (row?.["type"] === "TimelineClearCache")
                capture.clear();
            const entries = Array.isArray(row?.["entries"]) ? row["entries"] : row?.["entry"] ? [row["entry"]] : [];
            for (const entry of entries) {
                const content = record(record(entry)?.["content"]);
                addItem(content?.["itemContent"]);
                if (Array.isArray(content?.["items"]))
                    for (const child of content["items"]) {
                        addItem(record(record(child)?.["item"])?.["itemContent"]);
                    }
            }
        }
    };
    const requests = (() => {
        let scope = 0;
        let pendingMetadata = Promise.resolve();
        let pageUrl = location.href.split("#")[0];
        const resetScope = () => { capture.reset(); scope++; pendingMetadata = Promise.resolve(); };
        const syncPage = () => {
            const current = location.href.split("#")[0];
            if (pageUrl !== current) {
                resetScope();
                pageUrl = current;
            }
        };
        // Request metadata is used transiently for scope/cursor detection, never retained.
        const unreadableBody = Symbol();
        const begin = (rawUrl, body, readBody) => {
            syncPage();
            if (!bookmarkPage())
                return undefined;
            try {
                const url = new URL(rawUrl, location.href);
                if (url.origin !== location.origin)
                    return undefined;
                const operation = /^\/i\/api\/graphql\/[^/]+\/([^/]+)$/.exec(url.pathname)?.[1];
                // /i/history shares its URL with Likes. Never mix that tab with bookmarks.
                if (operation === "Likes") {
                    resetScope();
                    return undefined;
                }
                if (operation !== "Bookmarks")
                    return undefined;
                const requestScope = scope;
                // Clone/read before native fetch consumes Request, but classify in start order.
                let bodyResult;
                try {
                    bodyResult = readBody ? readBody().catch(() => unreadableBody) : Promise.resolve(body);
                }
                catch {
                    bodyResult = Promise.resolve(unreadableBody);
                }
                const token = pendingMetadata.then(async () => {
                    const rawBody = await bodyResult;
                    syncPage();
                    if (requestScope !== scope)
                        return undefined;
                    try {
                        if (rawBody != null && typeof rawBody !== "string")
                            throw new Error("Unreadable request body");
                        const request = typeof rawBody === "string" ? record(JSON.parse(rawBody)) : undefined;
                        const variables = record(request?.["variables"] ?? JSON.parse(url.searchParams.get("variables") ?? "{}"));
                        if (!variables?.["cursor"])
                            capture.reset();
                        return capture.generation();
                    }
                    catch {
                        capture.fail();
                        return undefined;
                    }
                });
                pendingMetadata = token.then(() => undefined);
                return token;
            }
            catch {
                return undefined;
            }
        };
        return { begin, syncPage, resetScope, settled: () => pendingMetadata };
    })();
    Object.defineProperty(window, bridge, { value: () => {
            requests.syncPage();
            return capture.snapshot();
        } });
    const observe = (token, response) => {
        void Promise.all([token, response]).then(async ([generationToken, result]) => {
            // Later requests may still be identifying a head reset. Wait before ingesting.
            await requests.settled();
            requests.syncPage();
            if (generationToken === undefined || !capture.accepts(generationToken) || !bookmarkPage())
                return;
            try {
                if (result.ok)
                    ingest(result.data, generationToken);
                else
                    capture.fail();
            }
            catch {
                capture.fail();
            }
        });
    };
    // Observe only responses to requests made by X. No replay or additional request.
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
        let token;
        try {
            const input = args[0];
            const body = args[1]?.body;
            token = requests.begin(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, body, input instanceof Request && body == null && input.body !== null ? () => input.clone().text() : undefined);
        }
        catch { /* Leave X's request untouched. */ }
        const promise = Reflect.apply(originalFetch, this, args);
        if (token !== undefined)
            observe(token, promise.then(async (response) => {
                // Clone immediately, before the caller consumes its response during metadata reads.
                if (!response.ok)
                    return { ok: false };
                return { ok: true, data: await response.clone().json() };
            }).catch(() => ({ ok: false })));
        return promise;
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const urls = new WeakMap();
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        Reflect.apply(originalOpen, this, [method, url, ...rest]);
        urls.set(this, String(url));
    };
    XMLHttpRequest.prototype.send = function (body) {
        const token = requests.begin(urls.get(this) ?? "", body);
        const onLoad = () => {
            if (token === undefined)
                return;
            let result = { ok: false };
            // Snapshot at load: this XHR may be reopened while metadata is pending.
            try {
                if (this.status >= 200 && this.status < 300) {
                    result = { ok: true, data: this.responseType === "json" ? this.response : JSON.parse(this.responseText) };
                }
            }
            catch { /* Keep an explicit failure for this request's generation. */ }
            observe(token, Promise.resolve(result));
        };
        if (token !== undefined) {
            this.addEventListener("load", onLoad, { once: true });
            this.addEventListener("loadend", () => this.removeEventListener("load", onLoad), { once: true });
        }
        Reflect.apply(originalSend, this, [body]);
    };
    for (const name of ["pushState", "replaceState"]) {
        const original = history[name];
        history[name] = function (...args) {
            Reflect.apply(original, this, args);
            requests.syncPage();
        };
    }
    addEventListener("popstate", requests.syncPage);
    addEventListener("pagehide", requests.resetScope);
}
