import { defaultDisplayedImageGroup, normalizeImageUrls } from "../core/images.js";
import { localizeErrorMessage, t } from "./localization.js";
import { scanTab, scanUrl } from "./page-access.js";
function isWebUrl(url) {
    return url !== undefined && /^https?:\/\//i.test(url);
}
/** Owns one scan from URL validation through atomic publication and cancellation. */
export function createScanSessionController(options) {
    let state = "initial";
    let activeController = null;
    async function start(collectionLink) {
        if (options.isBusy())
            return;
        const session = options.getCollectionSession();
        const enteredUrl = options.getEnteredUrl();
        let targetUrl = "";
        if (enteredUrl) {
            try {
                const parsed = new URL(enteredUrl);
                if (!isWebUrl(parsed.href))
                    throw new Error();
                targetUrl = parsed.href;
            }
            catch {
                options.onStatus(t("errorInvalidUrl"), "error");
                options.onShowSourceInput();
                return;
            }
        }
        options.clearAnalyzedUrl();
        options.onHideSourceInput();
        const controller = new AbortController();
        activeController = controller;
        state = "scanning";
        options.onBusyChange(true);
        options.onStatus(t("scanBusy"), "busy");
        try {
            let result;
            if (targetUrl) {
                result = await scanUrl(targetUrl, controller.signal);
            }
            else {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTab?.id === undefined || !isWebUrl(activeTab.url))
                    throw new Error(t("errorNoActivePage"));
                result = await scanTab(activeTab.id, controller.signal);
            }
            if (options.isDisposed() || controller.signal.aborted || activeController !== controller)
                return;
            const urls = normalizeImageUrls(result.images, result.url);
            // Publish only a complete scan. A rejected scan keeps the previous working set.
            options.collection.replace(urls, result.url);
            if (collectionLink)
                options.markAnalyzedUrl(collectionLink, session);
            state = options.collection.items.length ? "results" : "empty";
            options.onResults(result.title || t("imageFallback"), defaultDisplayedImageGroup(options.collection.groups));
            options.onStatus(options.collection.items.length ? "" : t("scanEmpty"), "info");
        }
        catch (error) {
            if (options.isDisposed() || controller.signal.aborted || activeController !== controller)
                return;
            state = options.collection.items.length ? "results" : "error";
            const reason = error instanceof Error
                ? localizeErrorMessage(error.message, "errorPageRead", true)
                : t("errorPageRead");
            options.onStatus(reason + (options.collection.items.length ? t("previousResults") : ""), "error");
        }
        finally {
            if (activeController === controller) {
                activeController = null;
                if (!options.isDisposed())
                    options.onBusyChange(false);
            }
        }
    }
    return {
        get state() { return state; },
        get isRunning() { return activeController !== null; },
        start,
        abort() { activeController?.abort(); },
        reset() { state = "initial"; },
    };
}
