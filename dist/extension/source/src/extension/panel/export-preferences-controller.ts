import { saveExportFormat, saveSourcePagePreference } from "../browser/export-preferences.js";
import type { AppElements } from "./app-elements.js";
import type { ExportControllerOptions } from "./export-operation.js";
import type { createExportSession } from "./export-session.js";
import { t } from "./localization.js";

interface ExportPreferencesControllerOptions {
  readonly elements: Pick<AppElements, "includeSourcePage" | "exportFormatInputs">;
  readonly session: ReturnType<typeof createExportSession>;
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
      if (!saveExportFormat(format)) {
        session.invalidateCompletion();
        options.onStatus(t("errorSaveFormatPreference"), "error");
      }
      options.onSelectionChange();
    });
  }
}
