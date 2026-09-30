/**
 * Read video URLs from data already attached to X/Twitter articles.
 *
 * This function is passed directly to chrome.scripting.executeScript in the
 * page's MAIN world. Keep every helper inside it so it remains serializable.
 */
export function scanXMedia() {
    const hostname = location.hostname.toLowerCase();
    if (!(hostname === "x.com" || hostname.endsWith(".x.com")
        || hostname === "twitter.com" || hostname.endsWith(".twitter.com")))
        return [];
    const deadline = performance.now() + 2_500;
    const maxArticles = 60;
    const maxNodes = 18_000;
    const maxDepth = 36;
    let visitedNodes = 0;
    const resultByUrl = new Map();
    const timedOut = () => performance.now() >= deadline || visitedNodes >= maxNodes;
    const dataValue = (value, key) => {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
                ? descriptor.value
                : undefined;
        }
        catch {
            return undefined;
        }
    };
    const httpUrl = (value) => {
        if (typeof value !== "string" || value.length === 0)
            return undefined;
        try {
            const url = new URL(value, location.href);
            if (url.protocol !== "http:" && url.protocol !== "https:")
                return undefined;
            return url.href;
        }
        catch {
            return undefined;
        }
    };
    const previewUrl = (value) => {
        const url = httpUrl(value);
        if (!url)
            return undefined;
        try {
            const parsed = new URL(url);
            const format = parsed.searchParams.get("format")?.toLowerCase();
            if (/\.(?:jpe?g|png|webp|avif|gif)$/i.test(parsed.pathname)
                || ["jpg", "jpeg", "png", "webp", "avif", "gif"].includes(format ?? ""))
                return url;
        }
        catch {
            return undefined;
        }
        return undefined;
    };
    const addVideoInfo = (videoInfo, mediaObject) => {
        const variants = dataValue(videoInfo, "variants");
        if (!Array.isArray(variants))
            return false;
        let best;
        const variantCount = dataValue(variants, "length");
        if (typeof variantCount !== "number")
            return false;
        for (let index = 0; index < variantCount; index += 1) {
            if (timedOut())
                return false;
            const variant = dataValue(variants, String(index));
            if (typeof variant !== "object" || variant === null)
                continue;
            const rawUrl = dataValue(variant, "url");
            const url = httpUrl(rawUrl);
            if (!url)
                continue;
            const rawContentType = dataValue(variant, "content_type") ?? dataValue(variant, "mime_type");
            const contentType = typeof rawContentType === "string" ? rawContentType.toLowerCase() : "";
            let isMp4 = /^video\/mp4(?:\s*;|$)/i.test(contentType);
            try {
                isMp4 ||= /\.mp4$/i.test(new URL(url).pathname);
            }
            catch {
                continue;
            }
            if (!isMp4)
                continue;
            const rawBitrate = dataValue(variant, "bitrate");
            const bitrate = typeof rawBitrate === "number" && Number.isFinite(rawBitrate) ? rawBitrate : 0;
            if (!best || bitrate > best.bitrate)
                best = { url, bitrate };
        }
        if (!best)
            return false;
        const candidate = { url: best.url, kind: "video" };
        for (const key of ["media_url_https", "media_url", "thumbnail_url", "preview_image_url", "poster"]) {
            const preview = previewUrl(dataValue(mediaObject, key));
            if (preview) {
                candidate.previewUrl = preview;
                break;
            }
        }
        const existing = resultByUrl.get(candidate.url);
        if (!existing || (!existing.previewUrl && candidate.previewUrl))
            resultByUrl.set(candidate.url, candidate);
        return true;
    };
    // Only follow fields that belong to a tweet and its media. In particular,
    // do not recursively inspect arbitrary React props such as app stores,
    // caches, clients, event handlers, or unrelated page state.
    const tweetPropKeys = [
        "tweet", "tweetResult", "tweet_results", "tweetResults", "tweet_result",
        "post", "mediaDetails", "media_details", "legacy", "extended_entities",
        "extendedEntities", "video_info", "videoInfo",
    ];
    const tweetDataKeys = [
        "tweet", "tweetResult", "tweet_results", "tweetResults", "tweet_result",
        "retweeted_status", "retweetedStatus", "quoted_status", "quotedStatus", "post", "result",
        "legacy", "extended_entities", "extendedEntities", "mediaDetails", "media_details",
        "entities", "media", "video_info", "videoInfo",
    ];
    const inspectPostTree = (roots) => {
        const pending = [];
        for (let index = roots.length - 1; index >= 0; index -= 1)
            pending.push({ value: roots[index], depth: 0 });
        const seenInTree = new WeakSet();
        let foundVideo = false;
        while (pending.length > 0 && !timedOut()) {
            const entry = pending.pop();
            if (!entry || typeof entry.value !== "object" || entry.value === null)
                continue;
            const value = entry.value;
            if (seenInTree.has(value))
                continue;
            seenInTree.add(value);
            visitedNodes += 1;
            if (Array.isArray(value)) {
                if (entry.depth >= maxDepth)
                    continue;
                const length = dataValue(value, "length");
                if (typeof length === "number") {
                    for (let index = length - 1; index >= 0; index -= 1) {
                        if (timedOut())
                            break;
                        const child = dataValue(value, String(index));
                        if (typeof child === "object" && child !== null)
                            pending.push({ value: child, depth: entry.depth + 1 });
                    }
                }
                continue;
            }
            const videoInfo = dataValue(value, "video_info") ?? dataValue(value, "videoInfo");
            if (typeof videoInfo === "object" && videoInfo !== null && addVideoInfo(videoInfo, value))
                foundVideo = true;
            if (entry.depth >= maxDepth)
                continue;
            for (const key of tweetDataKeys) {
                if (timedOut())
                    break;
                const child = dataValue(value, key);
                if (typeof child === "object" && child !== null)
                    pending.push({ value: child, depth: entry.depth + 1 });
            }
        }
        return foundVideo;
    };
    const inspectTweetProps = (props) => {
        const directVideoInfo = dataValue(props, "video_info") ?? dataValue(props, "videoInfo");
        if (typeof directVideoInfo === "object" && directVideoInfo !== null && addVideoInfo(directVideoInfo, props))
            return true;
        const roots = [];
        for (const key of tweetPropKeys) {
            if (timedOut())
                break;
            const value = dataValue(props, key);
            if (typeof value === "object" && value !== null)
                roots.push(value);
        }
        return inspectPostTree(roots);
    };
    const articles = document.querySelectorAll("article");
    const articleCount = Math.min(articles.length, maxArticles);
    for (let articleIndex = 0; articleIndex < articleCount && !timedOut(); articleIndex += 1) {
        const article = articles[articleIndex];
        if (!article)
            continue;
        let ownKeys;
        try {
            ownKeys = Object.getOwnPropertyNames(article);
        }
        catch {
            continue;
        }
        let articleHasPostVideo = false;
        for (const key of ownKeys) {
            if (timedOut())
                break;
            const directProps = key.startsWith("__reactProps$") ? dataValue(article, key) : undefined;
            if (typeof directProps === "object" && directProps !== null) {
                articleHasPostVideo = inspectTweetProps(directProps);
                if (articleHasPostVideo)
                    break;
            }
        }
        if (articleHasPostVideo)
            continue;
        for (const key of ownKeys) {
            if (timedOut())
                break;
            if (!key.startsWith("__reactFiber$") && !key.startsWith("__reactInternalInstance$"))
                continue;
            let fiber = dataValue(article, key);
            for (let ancestor = 0; typeof fiber === "object" && fiber !== null && ancestor < 40 && !timedOut(); ancestor += 1) {
                const memoizedProps = dataValue(fiber, "memoizedProps");
                let foundInProps = typeof memoizedProps === "object" && memoizedProps !== null
                    ? inspectTweetProps(memoizedProps)
                    : false;
                const pendingProps = dataValue(fiber, "pendingProps");
                if (!foundInProps && typeof pendingProps === "object" && pendingProps !== null && pendingProps !== memoizedProps) {
                    foundInProps = inspectTweetProps(pendingProps);
                }
                if (foundInProps)
                    break;
                fiber = dataValue(fiber, "return");
            }
        }
    }
    return [...resultByUrl.values()];
}
