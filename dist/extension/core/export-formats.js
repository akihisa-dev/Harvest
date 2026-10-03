/** User-facing order and the accepted persisted format values share one contract. */
export const exportFormats = ["mp4", "gif", "pdf", "jpg", "png", "jxl"];
const formatKinds = {
    mp4: "video",
    gif: "gif",
    pdf: "image",
    jpg: "image",
    png: "image",
    jxl: "image",
};
export function isExportFormat(value) {
    return typeof value === "string" && exportFormats.some(format => format === value);
}
/** Unknown legacy callers retain the still-image selection used by the old API. */
export function exportFormatMediaKind(format) {
    if (format === "original")
        return "all";
    return isExportFormat(format) ? formatKinds[format] : "image";
}
export function isMediaArchiveFormat(format) {
    return exportFormatMediaKind(format) !== "image";
}
/** A media-only preference needs a scan before it can become the active format. */
export function restoredExportFormat(format) {
    return formatKinds[format] === "image" ? format : "pdf";
}
export function initialExportFormat(items, saved) {
    if (items.some(item => item.kind === "video"))
        return "mp4";
    if (items.some(item => item.kind === "gif"))
        return "gif";
    return restoredExportFormat(saved);
}
export function availableExportFormats(items) {
    const kinds = new Set(items.map(item => item.kind ?? "image"));
    if (items.length === 0)
        kinds.add("image");
    return exportFormats.filter(format => kinds.has(formatKinds[format]));
}
