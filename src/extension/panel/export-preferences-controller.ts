import { saveSourcePagePreference } from "../browser/export-preferences.js";
import type { AppElements } from "./app-elements.js";
import type { ExportControllerOptions } from "./export-operation.js";
import type {createSplitExportSession} from "./split-export-session.js";
import {saveImageExportFormat,saveVideoExportFormat} from "../browser/split-export-preferences.js";
import { t } from "./localization.js";

interface ExportPreferencesControllerOptions {
  readonly elements: Pick<AppElements, "includeSourcePage" | "exportFormatInputs" | "videoExportFormatInputs">;
  readonly session: ReturnType<typeof createSplitExportSession>;
  readonly onStatus: ExportControllerOptions["onStatus"];
  readonly onSelectionChange: () => void;
  readonly onRender: () => void;
}

/** Applies explicit preference changes; a failed write invalidates any saved confirmation. */
export function bindExportPreferences(options: ExportPreferencesControllerOptions): void {
  const {session, elements} = options;
  elements.includeSourcePage.addEventListener("change", () => {
    session.setIncludeSourcePage(elements.includeSourcePage.checked);
    if (!saveSourcePagePreference(session.includeSourcePage)) {
      session.invalidateCompletion();
      options.onStatus(t("errorSavePreference"), "error");
    }
    options.onRender();
  });
  for (const {format, input} of elements.exportFormatInputs) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      session.setFormat(format);
      if (!saveImageExportFormat(format)) {
        session.invalidateCompletion();
        options.onStatus(t("errorSaveFormatPreference"), "error");
      }
      options.onSelectionChange();
    });
  }
  for (const {format,input} of elements.videoExportFormatInputs) {
    input.addEventListener("change",() => {
      if (!input.checked) return;
      session.setVideoFormat(format);
      if (!saveVideoExportFormat(format)) {session.invalidateCompletion();options.onStatus(t("errorSaveFormatPreference"),"error");}
      options.onSelectionChange();
    });
  }

}
