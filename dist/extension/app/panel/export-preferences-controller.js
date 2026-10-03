import { saveExportFormat, saveSourcePagePreference } from "../browser/export-preferences.js";
import { t } from "./localization.js";
/** Applies explicit preference changes; a failed write invalidates any saved confirmation. */
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
            if (!saveExportFormat(format)) {
                session.invalidateCompletion();
                options.onStatus(t("errorSaveFormatPreference"), "error");
            }
            options.onSelectionChange();
        });
    }
}
