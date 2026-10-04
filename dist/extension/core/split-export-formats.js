export const imageExportFormats = ["original", "recommend", "pdf", "jpg", "png", "jxl"];
export const videoExportFormats = ["original", "recommend", "mp4"];
export function isImageExportFormat(value) {
    return imageExportFormats.some(format => format === value);
}
export function isVideoExportFormat(value) {
    return videoExportFormats.some(format => format === value);
}
/** Migrate the old shared choice without excluding either media kind. */
export function migrateExportFormats(value) {
    if (value === "original" || value === "recommend")
        return { imageFormat: value, videoFormat: value };
    return { imageFormat: isImageExportFormat(value) ? value : "recommend", videoFormat: value === "mp4" ? "mp4" : "recommend" };
}
export function isStillImage(item) {
    return item.kind !== "video" && item.kind !== "gif" && item.recommendedFormat !== "gif";
}
export function splitSettingsMatch(a, b) {
    return a.imageFormat === b.imageFormat && a.videoFormat === b.videoFormat && a.includeSourcePage === b.includeSourcePage;
}
export function indexedExportFilename(index, count, extension) {
    return `${String(index + 1).padStart(Math.max(3, String(count).length), "0")}.${extension}`;
}
/** A lone PDF uses the page title; a PDF inside a ZIP uses its actual indexed entry name. */
export function pdfSourceFilename(selectedCount, pdfIndex, otherOutputs, directFilename) {
    return otherOutputs > 0 ? indexedExportFilename(pdfIndex, selectedCount, "pdf") : directFilename;
}
