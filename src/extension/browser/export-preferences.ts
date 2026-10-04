const sourcePagePreferenceKey = "harvest.includeSourcePage";

export function saveSourcePagePreference(include: boolean, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(sourcePagePreferenceKey, String(include));
    return true;
  } catch {
    return false;
  }
}
