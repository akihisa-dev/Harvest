import { saveSourcePagePreference } from "../browser/export-preferences.js";
import type { AppElements } from "./app-elements.js";
import type { ExportControllerOptions } from "./export-operation.js";
import type {createSplitExportSession} from "./split-export-session.js";
import { t } from "./localization.js";

interface ExportPreferencesControllerOptions {
  readonly elements: Pick<AppElements, "includeSourcePage" | "exportFormatInputs" | "videoExportFormatInputs">;
  readonly session: ReturnType<typeof createSplitExportSession>;
  readonly onStatus: ExportControllerOptions["onStatus"];
  readonly onSelectionChange: () => void;
  readonly onRender: () => void;
}

/** Format choices last for this panel; only the source-page preference is persisted. */
export function bindExportPreferences(options: ExportPreferencesControllerOptions): void {
  const {session, elements} = options;
  const updatePreference = (update: () => void): void => {
    const retryRequired = session.state.view.phase === "retry-required";
    update();
    const phase = session.state.view.phase;
    if (retryRequired && (phase === "ready" || phase === "empty")) {
      options.onStatus(t("exportSettingsChanged"), "info");
    }
  };
  elements.includeSourcePage.addEventListener("change", () => {
    updatePreference(() => session.setIncludeSourcePage(elements.includeSourcePage.checked));
    if (!saveSourcePagePreference(session.includeSourcePage)) {
      session.invalidateCompletion();
      options.onStatus(t("errorSavePreference"), "error");
    }
    options.onRender();
  });
  for (const {format, input} of elements.exportFormatInputs) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      updatePreference(() => session.setFormat(format));
      options.onSelectionChange();
    });
  }
  for (const {format,input} of elements.videoExportFormatInputs) {
    input.addEventListener("change",() => {
      if (!input.checked) return;
      updatePreference(() => session.setVideoFormat(format));
      options.onSelectionChange();
    });
  }

}
