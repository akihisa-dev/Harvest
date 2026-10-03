export function saveFilesIndividually(format, count, items = []) {
    return format === "mp4" || count === 1 || (format === "recommend" && items.length > 0 && items.every(item => item.kind === "video"));
}
/** Use the page title for one file and a stable sequence for multiple videos. */
export function individualFilename(zipFilename, entryFilename, count) {
    const base = zipFilename.replace(/\.zip$/i, "");
    return count === 1 ? `${base}.${entryFilename.split(".").pop()}` : `${base}_${entryFilename}`;
}
