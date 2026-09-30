/** Conversion formats include still images; original export preserves every selected file. */
export function mediaExportSelection(items, format) {
    return items.filter(item => format === "original" || (item.kind ?? "image") === "image");
}
export function hasStillImages(items) {
    return items.some(item => (item.kind ?? "image") === "image");
}
