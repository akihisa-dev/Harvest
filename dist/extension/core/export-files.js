export function saveFilesIndividually(format, count) {
    return format === "mp4" || count === 1;
}
/** Use the page title for one file and a stable sequence for multiple videos. */
export function individualFilename(zipFilename, entryFilename, count) {
    const base = zipFilename.replace(/\.zip$/i, "");
    return count === 1 ? `${base}.${entryFilename.split(".").pop()}` : `${base}_${entryFilename}`;
}
