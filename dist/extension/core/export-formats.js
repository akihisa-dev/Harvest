import { mediaFormat } from "./images.js";
/** User-facing order and the accepted persisted format values share one contract. */
export const exportFormats = ["original", "recommend", "mp4", "gif", "pdf", "jpg", "png", "jxl"];
const formatKinds = {
    original: "all",
    recommend: "all",
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
    return formatKinds[format] === "video" || formatKinds[format] === "gif" ? "pdf" : format;
}
export function initialExportFormat(items, saved) {
    if (saved === "original" || saved === "recommend")
        return saved;
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
    return exportFormats.filter(format => {
        const kind = formatKinds[format];
        return kind === "all" || kinds.has(kind);
    });
}
export function recommendedItemFormat(item) {
    return item.kind === "video" ? "mp4" : item.kind === "gif" ? "gif" : item.recommendedFormat ?? "png";
}
export function itemArchiveFormat(format, item) {
    return format === "recommend" ? recommendedItemFormat(item) : format;
}
/** URL-derived labels are hints; original downloads use their validated response MIME type. */
export function originalItemExtension(item) {
    if (item.originalExtension)
        return item.originalExtension.toUpperCase();
    if (item.kind === "gif")
        return "GIF";
    const { extension } = mediaFormat(item.url);
    return extension === "不明" ? null : extension;
}
