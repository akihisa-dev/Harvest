import { isExportFormat } from "../core/export-formats.js";
const sourcePagePreferenceKey = "harvest.includeSourcePage";
const exportFormatPreferenceKey = "harvest.exportFormat";
export function loadExportPreferences(storage = localStorage) {
    try {
        const storedFormat = storage.getItem(exportFormatPreferenceKey);
        return {
            format: storedFormat && isExportFormat(storedFormat) ? storedFormat : "pdf",
            includeSourcePage: storage.getItem(sourcePagePreferenceKey) === "true",
        };
    }
    catch {
        return { format: "pdf", includeSourcePage: false };
    }
}
export function saveExportFormat(format, storage = localStorage) {
    try {
        storage.setItem(exportFormatPreferenceKey, format);
        return true;
    }
    catch {
        return false;
    }
}
export function saveSourcePagePreference(include, storage = localStorage) {
    try {
        storage.setItem(sourcePagePreferenceKey, String(include));
        return true;
    }
    catch {
        return false;
    }
}
