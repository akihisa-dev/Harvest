import type { XScanDiagnostics } from "../../core/x-media.js";
import type { ImageCollection } from "../../core/image-collection.js";
import { defaultDisplayedImageGroup, normalizeImageUrls } from "../../core/images.js";
import { localizeErrorMessage, t } from "./localization.js";
import { scanTab, scanUrl } from "../browser/page-access.js";

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
  readonly diagnostics: {scan?: XScanDiagnostics; normalized: number; rejected: number} | null;
  readonly state: ScanState;
  readonly isRunning: boolean;
  start(collectionLink?: string): Promise<void>;
  stop(): void;
  abort(): void;
  reset(): void;
}

function isWebUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}

function isBookmarkUrl(url: string): boolean {
  const parsed = new URL(url);
  return /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url)
    && /^\/i\/(?:history|bookmarks)(?:\/|$)/i.test(parsed.pathname);
}

/** Owns one scan from URL validation through atomic publication and cancellation. */
export function createScanSessionController(options: ScanSessionControllerOptions): ScanSessionController {
  let state: ScanState = "initial";
  let diagnostics: ScanSessionController["diagnostics"] = null;
  let stopRequested = false;
  let activeController: AbortController | null = null;
  let bookmarkScan: boolean | null = null;

  async function start(collectionLink?: string): Promise<void> {
    if (activeController || options.isBusy() || options.isDisposed()) return;
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
    stopRequested = false;
    bookmarkScan = targetUrl ? isBookmarkUrl(targetUrl) : null;
    state = "scanning";
    diagnostics = null;
    options.onBusyChange(true);
    options.onStatus(t("scanBusy"), "busy");
    try {
      const scanOptions = {shouldStop: () => stopRequested, onProgress: (posts: number) => {
        if (!options.isDisposed() && !controller.signal.aborted) options.onStatus(t("scanBookmarksBusy", {count: posts}), "busy");
      }};
      let result;
      if (targetUrl) {
        result = await scanUrl(targetUrl, controller.signal, scanOptions);
      } else {
        const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
        if (options.isDisposed() || controller.signal.aborted || activeController !== controller) return;
        if (activeTab?.id === undefined || !isWebUrl(activeTab.url)) throw new Error(t("errorNoActivePage"));
        bookmarkScan = isBookmarkUrl(activeTab.url);
        if (stopRequested && !bookmarkScan) {
          controller.abort();
          throw new Error(t("errorScanCancelled"));
        }
        result = await scanTab(activeTab.id, controller.signal, activeTab.url, scanOptions);
      }
      if (options.isDisposed() || controller.signal.aborted || activeController !== controller) return;
      const urls = normalizeImageUrls([...result.images, ...(result.media ?? []).map(item => item.url)], result.url);
      // Publish usable media, with an explicit notice when X supplementation is incomplete.
      const media = (result.media ?? []).flatMap(item => {
        const normalized = normalizeImageUrls([item.url], result.url)[0];
        return normalized ? [{...item, url: normalized}] : [];
      });
      const rejected = (result.media ?? []).length - media.length;
      diagnostics = {...(result.xDiagnostics ? {scan: result.xDiagnostics} : {}), normalized: urls.length, rejected};
      if (result.xDiagnostics && rejected && !urls.length) throw new Error(t("errorXIncomplete"));
      options.collection.replace(urls, result.url, media);
      if (collectionLink) options.markAnalyzedUrl(collectionLink, session);
      state = options.collection.items.length ? "results" : "empty";
      options.onResults(result.title || t("imageFallback"), result.xDiagnostics ? null : defaultDisplayedImageGroup(options.collection.groups), result.url);
      const partial = result.xDiagnostics && (result.xDiagnostics.limited || result.xDiagnostics.unresolved || rejected);
      options.onStatus(result.xDiagnostics?.bookmarkStopped ? t("scanBookmarksStopped") : result.xDiagnostics?.bookmarkIncomplete ? t("scanBookmarksIncomplete") : result.xDiagnostics?.bookmarkCaptureMissing ? t("scanXBookmarksReload") : partial ? t("scanXPartial") : options.collection.items.length ? "" : t("scanEmpty"), "info");
    } catch (error) {
      if (options.isDisposed() || activeController !== controller) return;
      if (controller.signal.aborted) {
        if (stopRequested) {
          state = options.collection.items.length ? "results" : "initial";
          options.onStatus(t("errorScanCancelled") + (options.collection.items.length ? t("previousResults") : ""), "info");
        }
        return;
      }
      state = options.collection.items.length ? "results" : "error";
      const reason = error instanceof Error
        ? localizeErrorMessage(error.message, "errorPageRead", true)
        : t("errorPageRead");
      options.onStatus(reason + (options.collection.items.length ? t("previousResults") : ""), "error");
    } finally {
      if (activeController === controller) {
        activeController = null;
        bookmarkScan = null;
        if (!options.isDisposed()) options.onBusyChange(false);
      }
    }
  }

  return {
    get diagnostics() { return diagnostics; },
    get state() { return state; },
    get isRunning() { return activeController !== null; },
    start,
    stop() {
      stopRequested = true;
      if (bookmarkScan === false) activeController?.abort();
    },
    abort() { activeController?.abort(); },
    reset() {
      activeController?.abort();
      state = "initial";
      diagnostics = null;
    },
  };
}
