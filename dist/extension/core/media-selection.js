/** Selects media compatible with the requested archive format. */
export function mediaExportSelection(items, format) {
    return items.filter(item => {
        const kind = item.kind ?? "image";
        if (format === "original")
            return true;
        if (format === "gif")
            return kind === "gif";
        if (format === "mp4")
            return kind === "video";
        return kind === "image";
    });
}
export function hasStillImages(items) {
    return items.some(item => (item.kind ?? "image") === "image");
}
