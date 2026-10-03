import { exportFormatMediaKind } from "./export-formats.js";
/** Selects media compatible with the requested archive format. */
export function mediaExportSelection(items, format) {
    const kind = exportFormatMediaKind(format);
    return items.filter(item => kind === "all" || (item.kind ?? "image") === kind);
}
export function hasStillImages(items) {
    return items.some(item => (item.kind ?? "image") === "image");
}
/** Replace only alternatives explicitly identified by the same media's playback data. */
export function mergeMediaCandidates(base, preferred) {
    const superseded = new Set(preferred.flatMap(item => item.kind === "video" ? item.variantUrls ?? [] : []));
    const byUrl = new Map();
    for (const item of [...base, ...preferred]) {
        if (item.kind === "video" && superseded.has(item.url))
            continue;
        const previous = byUrl.get(item.url);
        const previewUrl = item.previewUrl ?? previous?.previewUrl;
        byUrl.set(item.url, { url: item.url, kind: item.kind, ...(previewUrl ? { previewUrl } : {}) });
    }
    return [...byUrl.values()];
}
/** X uses both file extensions and format/name parameters for the same photo. */
export function xPhotoKey(value) {
    try {
        const url = new URL(value);
        if (url.hostname !== "pbs.twimg.com" || !url.pathname.startsWith("/media/"))
            return value;
        const extension = /\.(jpg|jpeg|png|webp|avif|gif)$/i.exec(url.pathname);
        const format = url.searchParams.get("format") ?? extension?.[1];
        if (!format)
            return value;
        if (extension)
            url.pathname = url.pathname.slice(0, -extension[0].length);
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
