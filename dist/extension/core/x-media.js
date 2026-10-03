/** Match image URL spellings without ever merging two unrelated paths. */
export function xMediaUrlKey(value) {
    try {
        const url = new URL(value);
        if (url.hostname !== "pbs.twimg.com")
            return value;
        const ext = /\.(jpg|jpeg|png|webp|avif|gif)$/i.exec(url.pathname);
        const format = url.searchParams.get("format") ?? ext?.[1];
        if (!format)
            return value;
        if (ext)
            url.pathname = url.pathname.slice(0, -ext[0].length);
        url.searchParams.set("format", format.toLowerCase().replace(/^jpeg$/, "jpg"));
        url.searchParams.delete("name");
        url.searchParams.sort();
        url.hash = "";
        return url.href;
    }
    catch {
        return value;
    }
}
export function isXVideoPreview(value) {
    try {
        const url = new URL(value);
        return url.hostname === "pbs.twimg.com" && /^\/(?:amplify_video_thumb|tweet_video_thumb|ext_tw_video_thumb)\//.test(url.pathname);
    }
    catch {
        return false;
    }
}
/** Pure parser for bounded, whitelisted page snapshots. */
export function parseXMedia(snapshot, targetPostId) {
    const records = [];
    const missing = new Set();
    let excluded = 0, unavailable = 0, visited = 0;
    let limited = snapshot.limited;
    const obj = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
    const http = (value) => {
        if (typeof value !== "string")
            return undefined;
        try {
            const url = new URL(value, snapshot.url);
            return /^https?:$/.test(url.protocol) ? url.href : undefined;
        }
        catch {
            return undefined;
        }
    };
    const mp4 = (value, type) => {
        const url = http(value);
        return url && (/\.mp4$/i.test(new URL(url).pathname) || (typeof type === "string" && /^video\/mp4(?:\s*;|$)/i.test(type))) ? url : undefined;
    };
    const relatedKeys = new Set(["quoted_status_result", "quotedRefResult", "retweeted_status_result", "quoted_status", "quotedStatus", "retweeted_status", "retweetedStatus"]);
    const keys = ["tweet", "tweetResult", "tweet_results", "tweetResults", "tweet_result", "post", "result", "legacy", "extended_entities", "extendedEntities", "entities", "media", "mediaDetails", "media_details", ...relatedKeys];
    for (const post of snapshot.posts) {
        if (targetPostId && post.postId !== targetPostId) {
            excluded++;
            continue;
        }
        const start = records.length;
        const unresolved = [];
        const add = (candidate, source, bitrate = 0, identity) => {
            records.push({ candidate, source, bitrate, post: post.key, ...(identity ? { identity } : {}) });
        };
        const attached = (value, isMedia, ownerId) => {
            const rawId = value["media_key"] ?? (isMedia ? value["id_str"] : undefined);
            const identity = typeof rawId === "string" ? `${ownerId ?? post.postId ?? post.key}:${rawId}` : undefined;
            const preview = ["media_url_https", "media_url", "thumbnail_url", "preview_image_url", "poster"].map(key => http(value[key])).find(Boolean);
            if (isMedia && value["type"] === "photo") {
                if (preview)
                    add({ url: preview, kind: "image" }, "data", 0, identity);
                else
                    unresolved.push(identity ? { identity } : {});
                return;
            }
            const info = obj(value["video_info"] ?? value["videoInfo"]);
            const variants = info?.["variants"] ?? (isMedia ? value["variants"] : undefined);
            const urls = new Map();
            if (Array.isArray(variants))
                for (const variant of variants) {
                    const v = obj(variant);
                    const url = mp4(v?.["url"], v?.["content_type"] ?? v?.["mime_type"]);
                    const rate = v?.["bitrate"] ?? v?.["bit_rate"];
                    if (url)
                        urls.set(url, typeof rate === "number" && Number.isFinite(rate) ? rate : 0);
                }
            if (isMedia || info) {
                const source = obj(value["source"]);
                for (const raw of [value["src"], source?.["src"]]) {
                    const url = mp4(raw, source?.["content_type"] ?? value["content_type"]);
                    if (url && !urls.has(url))
                        urls.set(url, -1);
                }
            }
            const best = [...urls].sort((a, b) => b[1] - a[1])[0];
            if (best) {
                const variants = [...urls.keys()].filter(url => url !== best[0]);
                add({ url: best[0], kind: "video", ...(preview ? { previewUrl: preview } : {}), ...(variants.length ? { variantUrls: variants } : {}) }, "data", best[1], identity);
            }
            else if (isMedia && (value["type"] === "video" || value["type"] === "animated_gif")) {
                unresolved.push({ ...(identity ? { identity } : {}), ...(preview ? { preview } : {}) });
            }
        };
        for (const root of post.roots) {
            const seen = new WeakSet();
            const walk = (value, media, matched, related, depth, ownerId) => {
                if (!value || typeof value !== "object" || seen.has(value))
                    return;
                if (depth > 36 || ++visited > 18_000) {
                    limited = true;
                    return;
                }
                seen.add(value);
                if (Array.isArray(value)) {
                    for (const child of value)
                        walk(child, media, matched, related, depth + 1, ownerId);
                    return;
                }
                const data = obj(value);
                const id = data["rest_id"] ?? (!media ? data["id_str"] : undefined);
                if (typeof id === "string" && !media) {
                    if (post.postId && id !== post.postId && !related) {
                        excluded++;
                        return;
                    }
                    matched ||= id === post.postId;
                    ownerId = id;
                }
                if (matched && ["TweetTombstone", "TweetUnavailable"].includes(String(data["__typename"]))) {
                    unavailable++;
                    return;
                }
                if (matched)
                    attached(data, media, ownerId);
                for (const key of keys) {
                    if (relatedKeys.has(key) && (targetPostId || !matched))
                        continue;
                    if (!targetPostId && obj(data["retweeted_status_result"]) && ["extended_entities", "extendedEntities", "entities"].includes(key))
                        continue;
                    if (key === "entities" && (obj(data["extended_entities"])?.["media"] || obj(data["extendedEntities"])?.["media"]))
                        continue;
                    walk(data[key], media || ["media", "mediaDetails", "media_details"].includes(key), matched, related || relatedKeys.has(key), depth + 1, ownerId);
                }
            };
            walk(root.value, false, !root.requireIdentity || !post.postId, false, 0, post.postId);
            const direct = obj(root.value);
            if (direct && root.player && (!root.requireIdentity || !post.postId))
                attached(direct, true, post.postId);
        }
        // DOM evidence remains useful when React data is absent or its shape changes.
        for (const item of post.observed) {
            const url = http(item.url);
            const preview = http(item.previewUrl);
            if (item.kind === "image" && url && !isXVideoPreview(url))
                add({ url, kind: "image" }, "dom");
            else if (item.kind === "video" && url && /\.(?:mp4|webm)$/i.test(new URL(url).pathname)) {
                add({ url, kind: "video", ...(preview ? { previewUrl: preview } : {}) }, "dom", -1);
            }
        }
        const local = records.slice(start);
        let anonymousPlayers = 0;
        const matchedVideoUrls = new Set();
        for (const item of post.observed) {
            const video = item.kind === "video" || Boolean(item.url && isXVideoPreview(item.url));
            const reference = video ? item.previewUrl ?? (item.kind === "image" ? item.url : undefined) : item.url;
            const found = local.find(({ candidate }) => candidate.kind === (video ? "video" : "image") && ((item.url && (candidate.url === item.url || candidate.variantUrls?.includes(item.url)))
                || (reference && xMediaUrlKey(video ? candidate.previewUrl ?? "" : candidate.url) === xMediaUrlKey(reference))));
            if (found && video)
                matchedVideoUrls.add(found.candidate.url);
            if (!found) {
                if (video && !reference)
                    anonymousPlayers++;
                else
                    missing.add(post.key);
            }
        }
        // Without a poster or direct URL, only an unambiguous one-player/one-video
        // fallback is safe. Multiple anonymous players require another read.
        const remainingVideos = new Set(local.filter(r => r.candidate.kind === "video"
            && !matchedVideoUrls.has(r.candidate.url)).map(r => r.identity ?? r.candidate.url));
        if (anonymousPlayers && (anonymousPlayers !== 1 || remainingVideos.size !== 1 || matchedVideoUrls.size))
            missing.add(post.key);
        for (const item of unresolved) {
            if (!local.some(record => (item.identity && record.identity === item.identity)
                || (item.preview && record.candidate.kind === "video" && record.candidate.previewUrl
                    && xMediaUrlKey(record.candidate.previewUrl) === xMediaUrlKey(item.preview))))
                missing.add(post.key);
        }
    }
    // Explicit media IDs, URLs and variant relationships are the only merge edges.
    const parents = new Map();
    const find = (key) => {
        let root = key;
        while (parents.has(root))
            root = parents.get(root);
        while (parents.has(key)) {
            const next = parents.get(key);
            parents.set(key, root);
            key = next;
        }
        return root;
    };
    const urlKey = (item) => `${item.kind}:${item.kind === "image" ? xMediaUrlKey(item.url) : item.url}`;
    for (const record of records) {
        const key = find(urlKey(record.candidate));
        for (const alias of [...(record.identity ? [`id:${record.identity}`] : []), ...(record.candidate.variantUrls ?? []).map(url => `video:${url}`)]) {
            const from = find(alias);
            if (from !== key)
                parents.set(from, key);
        }
    }
    const groups = new Map();
    for (const record of records) {
        const key = find(urlKey(record.candidate));
        const group = groups.get(key) ?? [];
        group.push(record);
        groups.set(key, group);
    }
    const media = [...groups.values()].map(group => {
        const best = group.reduce((best, entry) => entry.bitrate > best.bitrate
            || (entry.candidate.kind === "image" && entry.source === "dom" && best.source !== "dom") ? entry : best).candidate;
        const preview = best.previewUrl ?? group.find(r => r.candidate.previewUrl)?.candidate.previewUrl;
        const alternatives = new Set(group.flatMap(r => [r.candidate.url, ...(r.candidate.variantUrls ?? [])]));
        alternatives.delete(best.url);
        return { url: best.url, kind: best.kind, ...(preview ? { previewUrl: preview } : {}),
            ...(best.kind === "video" && alternatives.size ? { variantUrls: [...alternatives] } : {}) };
    });
    // Posters are previews of resolved videos, not additional still photographs.
    const posters = new Set(media.filter(m => m.kind === "video" && m.previewUrl).map(m => xMediaUrlKey(m.previewUrl)));
    const resolved = media.filter(m => m.kind !== "image" || !posters.has(xMediaUrlKey(m.url)));
    return { media: resolved, missingPosts: [...missing], diagnostics: {
            posts: snapshot.posts.length, observed: snapshot.posts.reduce((n, post) => n + post.observed.length, 0),
            extracted: records.filter(r => r.source === "data").length, merged: resolved.length,
            excluded: excluded + media.length - resolved.length, unavailable, unresolved: missing.size, limited,
        } };
}
