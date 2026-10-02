import { exportFormatMediaKind } from "./export-formats.js";
/** Selects media compatible with the requested archive format. */
export function mediaExportSelection(items, format) {
    const kind = exportFormatMediaKind(format);
    return items.filter(item => kind === "all" || (item.kind ?? "image") === kind);
}
export function hasStillImages(items) {
    return items.some(item => (item.kind ?? "image") === "image");
}
