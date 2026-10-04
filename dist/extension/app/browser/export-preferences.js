const sourcePagePreferenceKey = "harvest.includeSourcePage";
export function saveSourcePagePreference(include, storage = localStorage) {
    try {
        storage.setItem(sourcePagePreferenceKey, String(include));
        return true;
    }
    catch {
        return false;
    }
}
