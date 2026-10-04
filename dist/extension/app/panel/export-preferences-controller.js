import { saveSourcePagePreference } from "../browser/export-preferences.js";
import { t } from "./localization.js";
/** Format choices last for this panel; only the source-page preference is persisted. */
export function bindExportPreferences(options) {
    const { session, elements } = options;
    elements.includeSourcePage.addEventListener("change", () => {
        session.setIncludeSourcePage(elements.includeSourcePage.checked);
        if (!saveSourcePagePreference(session.includeSourcePage)) {
            session.invalidateCompletion();
            options.onStatus(t("errorSavePreference"), "error");
        }
        options.onRender();
    });
    for (const { format, input } of elements.exportFormatInputs) {
        input.addEventListener("change", () => {
            if (!input.checked)
                return;
            session.setFormat(format);
            options.onSelectionChange();
        });
    }
    for (const { format, input } of elements.videoExportFormatInputs) {
        input.addEventListener("change", () => {
            if (!input.checked)
                return;
            session.setVideoFormat(format);
            options.onSelectionChange();
        });
    }
}
