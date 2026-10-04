import {isImageExportFormat, isVideoExportFormat, migrateExportFormats, type SplitExportSettings, type ImageExportFormat, type VideoExportFormat} from "../../core/split-export-formats.js";

const imageKey = "harvest.imageExportFormat";
const videoKey = "harvest.videoExportFormat";
/** Preserve the legacy key and source-page choice; valid independent keys win. */
export function loadSplitExportPreferences(storage: Storage = localStorage): SplitExportSettings {
  try {
    const migrated = migrateExportFormats(storage.getItem("harvest.exportFormat"));
    const storedImage = storage.getItem(imageKey), storedVideo = storage.getItem(videoKey);
    const imageFormat = isImageExportFormat(storedImage) ? storedImage : migrated.imageFormat;
    const videoFormat = isVideoExportFormat(storedVideo) ? storedVideo : migrated.videoFormat;
    // Best-effort migration cannot make a readable preference unusable.
    try {
      if (!isImageExportFormat(storedImage)) storage.setItem(imageKey, imageFormat);
      if (!isVideoExportFormat(storedVideo)) storage.setItem(videoKey, videoFormat);
    } catch { /* Keep the values for this panel if persistence is unavailable. */ }
    return {imageFormat, videoFormat, includeSourcePage: storage.getItem("harvest.includeSourcePage") === "true"};
  } catch { return {imageFormat: "recommend", videoFormat: "recommend", includeSourcePage: false}; }
}
export function saveImageExportFormat(format: ImageExportFormat, storage: Storage = localStorage): boolean {
  try { storage.setItem(imageKey, format); return true; } catch { return false; }
}
export function saveVideoExportFormat(format: VideoExportFormat, storage: Storage = localStorage): boolean {
  try { storage.setItem(videoKey, format); return true; } catch { return false; }
}
