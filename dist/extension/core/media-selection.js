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
