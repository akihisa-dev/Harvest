import type { ImageArchiveFormat } from "./image-format.js";

export type ExportFormat = "pdf" | Exclude<ImageArchiveFormat, "original">;

const sourcePagePreferenceKey = "harvest.includeSourcePage";
const exportFormatPreferenceKey = "harvest.exportFormat";

function isExportFormat(value: string): value is ExportFormat {
  return value === "mp4" || value === "gif" || value === "pdf" || value === "jpg" || value === "png" || value === "jxl";
}

export interface ExportPreferences {
  readonly format: ExportFormat;
  readonly includeSourcePage: boolean;
}

export function loadExportPreferences(storage: Storage = localStorage): ExportPreferences {
  try {
    const storedFormat = storage.getItem(exportFormatPreferenceKey);
    return {
      format: storedFormat && isExportFormat(storedFormat) ? storedFormat : "pdf",
      includeSourcePage: storage.getItem(sourcePagePreferenceKey) === "true",
    };
  } catch {
    return {format: "pdf", includeSourcePage: false};
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
