import { isExportFormat, type ExportFormat } from "../../core/export-formats.js";

export type { ExportFormat } from "../../core/export-formats.js";

const sourcePagePreferenceKey = "harvest.includeSourcePage";
const exportFormatPreferenceKey = "harvest.exportFormat";

export interface ExportPreferences {
  readonly format: ExportFormat;
  readonly includeSourcePage: boolean;
}

export function loadExportPreferences(storage: Storage = localStorage): ExportPreferences {
  try {
    const storedFormat = storage.getItem(exportFormatPreferenceKey);
    return {
      format: storedFormat && isExportFormat(storedFormat) ? storedFormat : "recommend",
      includeSourcePage: storage.getItem(sourcePagePreferenceKey) === "true",
    };
  } catch {
    return {format: "recommend", includeSourcePage: false};
  }
}

export function saveExportFormat(format: ExportFormat, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(exportFormatPreferenceKey, format);
    return true;
  } catch {
    return false;
  }
}

export function saveSourcePagePreference(include: boolean, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(sourcePagePreferenceKey, String(include));
    return true;
  } catch {
    return false;
  }
}
