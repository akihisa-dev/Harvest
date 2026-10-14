export function youtubeVideoId(value) {
    try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password)
            return null;
        let id = null;
        if (url.hostname === "youtu.be")
            id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
        else if (/^(?:www\.|m\.)?youtube\.com$/.test(url.hostname)) {
            id = url.pathname === "/watch" ? url.searchParams.get("v")
                : /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
        }
        return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    catch {
        return null;
    }
}
export function youtubeVideoUrl(videoId) {
    if (!/^[\w-]{11}$/.test(videoId))
        throw new Error("YouTubeの動画URLが不正です。");
    return `https://www.youtube.com/watch?v=${videoId}`;
}
export function isYoutubeSource(value) {
    if (!value || typeof value !== "object")
        return false;
    const row = value;
    return typeof row["videoId"] === "string" && /^[\w-]{11}$/.test(row["videoId"])
        && typeof row["quality"] === "string" && row["quality"].length <= 80
        && (row["bytes"] === undefined || (typeof row["bytes"] === "number" && Number.isSafeInteger(row["bytes"]) && row["bytes"] > 0));
}
/** Restrict every initial endpoint and server-directed replacement to the media CDN. */
export function youtubeStreamingUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port
        || !/^[a-z0-9-]+\.googlevideo\.com$/.test(url.hostname) || url.pathname !== "/videoplayback") {
        throw new Error("YouTubeの動画配信先を確認できませんでした。");
    }
    return url.href;
}
/** Choose compatible MP4 streams deterministically; never lower quality to fit a size cap. */
export function selectYoutubeFormats(formats) {
    const video = formats.filter(f => /^video\/mp4\s*;.*\bavc1\./i.test(f.mimeType))
        .sort((a, b) => b.height - a.height || b.fps - a.fps || b.bitrate - a.bitrate || a.itag - b.itag)[0];
    const audios = formats.filter(f => /^audio\/mp4\s*;.*\bmp4a\./i.test(f.mimeType));
    // Prefer the original/default language. Do not silently choose a random dubbed track.
    const defaults = audios.filter(f => f.defaultAudio);
    const original = audios.filter(f => !f.language);
    const pool = defaults.length ? defaults : original.length ? original : [];
    const audio = pool.sort((a, b) => b.bitrate - a.bitrate || a.itag - b.itag)[0];
    if (!video || !audio)
        throw new Error("このYouTube動画には保存できるMP4の映像・音声がありません。");
    return { video, audio };
}
