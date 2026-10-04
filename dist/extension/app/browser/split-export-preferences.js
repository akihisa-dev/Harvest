/** Each panel starts with recommended formats; old format preferences stay untouched. */
export function loadSplitExportPreferences(storage = localStorage) {
    let includeSourcePage = false;
    try {
        includeSourcePage = storage.getItem("harvest.includeSourcePage") === "true";
    }
    catch { /* The panel remains usable when browser storage is unavailable. */ }
    return { imageFormat: "recommend", videoFormat: "recommend", includeSourcePage };
}
