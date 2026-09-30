import type { ImageCollection } from "../core/image-collection.js";
import { defaultDisplayedImageGroup, normalizeImageUrls } from "../core/images.js";
import { localizeErrorMessage, t } from "./localization.js";
import { scanTab, scanUrl } from "./page-access.js";

export type ScanState = "initial" | "scanning" | "results" | "empty" | "error";

export interface ScanSessionControllerOptions {
  readonly collection: ImageCollection;
  readonly getEnteredUrl: () => string;
  readonly getCollectionSession: () => string | null;
  readonly clearAnalyzedUrl: () => void;
  readonly markAnalyzedUrl: (url: string, session: string | null) => void;
  readonly isBusy: () => boolean;
  readonly isDisposed: () => boolean;
  readonly onHideSourceInput: () => void;
  readonly onShowSourceInput: () => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onStatus: (message: string, state: "info" | "busy" | "success" | "error") => void;
  readonly onResults: (pageTitle: string, initialGroup: string | null, sourcePage: string) => void;
}

export interface ScanSessionController {
  readonly state: ScanState;
  readonly isRunning: boolean;
  start(collectionLink?: string): Promise<void>;
  abort(): void;
  reset(): void;
}

function isWebUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}

/** Owns one scan from URL validation through atomic publication and cancellation. */
export function createScanSessionController(options: ScanSessionControllerOptions): ScanSessionController {
  let state: ScanState = "initial";
  let activeController: AbortController | null = null;

  async function start(collectionLink?: string): Promise<void> {
    if (options.isBusy()) return;
    const session = options.getCollectionSession();
    const enteredUrl = options.getEnteredUrl();
    let targetUrl = "";
    if (enteredUrl) {
      try {
        const parsed = new URL(enteredUrl);
        if (!isWebUrl(parsed.href)) throw new Error();
        targetUrl = parsed.href;
      } catch {
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
      } else {
        const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
        if (activeTab?.id === undefined || !isWebUrl(activeTab.url)) throw new Error(t("errorNoActivePage"));
        result = await scanTab(activeTab.id, controller.signal, activeTab.url);
      }
      if (options.isDisposed() || controller.signal.aborted || activeController !== controller) return;
      const urls = normalizeImageUrls([...result.images, ...(result.media ?? []).map(item => item.url)], result.url);
      // Publish only a complete scan. A rejected scan keeps the previous working set.
      const media = (result.media ?? []).flatMap(item => {
        const normalized = normalizeImageUrls([item.url], result.url)[0];
        return normalized ? [{...item, url: normalized}] : [];
      });
      options.collection.replace(urls, result.url, media);
      if (collectionLink) options.markAnalyzedUrl(collectionLink, session);
      state = options.collection.items.length ? "results" : "empty";
      options.onResults(result.title || t("imageFallback"), defaultDisplayedImageGroup(options.collection.groups), result.url);
      options.onStatus(options.collection.items.length ? "" : t("scanEmpty"), "info");
    } catch (error) {
      if (options.isDisposed() || controller.signal.aborted || activeController !== controller) return;
      state = options.collection.items.length ? "results" : "error";
      const reason = error instanceof Error
        ? localizeErrorMessage(error.message, "errorPageRead", true)
        : t("errorPageRead");
      options.onStatus(reason + (options.collection.items.length ? t("previousResults") : ""), "error");
    } finally {
      if (activeController === controller) {
        activeController = null;
        if (!options.isDisposed()) options.onBusyChange(false);
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
