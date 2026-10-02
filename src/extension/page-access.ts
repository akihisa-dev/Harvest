import { waitForXPage, type XPageState } from "./x-page-state.js";
import { mergeMediaCandidates } from "../core/media-selection.js";
import { scanXMedia, type XMediaCandidate } from "./x-media-scan.js";
import { scanDocument, type PageScan } from "./page-scan.js";

const timeoutMs = 20000;
const pageMovedMessage = "解析中にページが移動しました。もう一度解析してください。";
const scanError = (error: unknown, fallback: string): Error => new Error(
  error instanceof Error && error.message.includes("解析中にページが移動しました") ? pageMovedMessage : fallback,
);

/** Ends the caller's wait and always releases listeners, even when Chrome rejects. */
function bounded<T>(start: (resolve: (value: T) => void, reject: (error: Error) => void) => (() => void) | void,
  signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let cleanup: (() => void) | void;
    const finish = (error?: Error, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      cleanup?.();
      if (error) reject(error);
      else resolve(value as T);
    };
    const onAbort = (): void => finish(new Error("ページの解析を終了しました。"));
    const timer = setTimeout(() => finish(new Error("ページの読み取りが時間切れになりました。もう一度お試しください。")), timeoutMs);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, {once: true});
    try {
      cleanup = start(value => finish(undefined, value), error => finish(error));
      if (settled) cleanup?.();
    } catch {
      finish(new Error("ページを読み取れませんでした。"));
    }
  });
}

export async function scanTab(tabId: number, signal?: AbortSignal, requestedUrl?: string): Promise<PageScan> {
  let documentId: string | undefined;
  let result = await bounded<PageScan>((resolve, reject) => {
    const onRemoved = (id: number): void => {
      if (id === tabId) reject(new Error("解析中のタブが閉じられました。"));
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    void chrome.scripting.executeScript({target: {tabId}, func: scanDocument}).then(([injection]) => {
      if (injection?.result) { documentId = injection.documentId; resolve(injection.result); }
      else reject(new Error("ページを読み取れませんでした。"));
    }, error => reject(scanError(error, "このページを読み取れませんでした。Chromeで開けるWebページを指定してください。")));
    return () => chrome.tabs.onRemoved.removeListener(onRemoved);
  }, signal);
  const sourceUrl = result.url;
  if (/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(result.url)) {
    const targetUrl = requestedUrl && /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(requestedUrl)
      ? requestedUrl : result.url;
    const expectVideo = /\/status\/\d+\/video\/\d+(?:[?#]|$)/i.test(targetUrl);
    const targetPostId = /\/status\/(\d+)(?:[/?#]|$)/i.exec(targetUrl)?.[1];
    const isPost = Boolean(targetPostId);
    if (isPost) {
      const state = await bounded<XPageState>((resolve, reject) => {
        void chrome.scripting.executeScript({target: {tabId}, func: waitForXPage, args: [expectVideo, 10_000, targetPostId]})
          .then(([injection]) => {
            if (documentId && injection?.documentId !== documentId) reject(new Error(pageMovedMessage));
            else if (injection?.result) resolve(injection.result);
            else reject(new Error("Xの投稿を読み取れませんでした。"));
          }, error => reject(scanError(error, "Xの投稿を読み取れませんでした。")));
      }, signal);
      if (state.status === "restricted") throw new Error("Xがこの投稿の表示を制限しています。Chromeで投稿を表示できる状態にしてから解析してください。");
      if (state.status === "unavailable") throw new Error("Xの投稿が削除されているか、表示できません。");
      if (state.status !== "ready") throw new Error("Xの投稿の読み込みが完了しませんでした。Chromeで投稿を開いてから解析し直してください。");
      result = await bounded<PageScan>((resolve, reject) => {
        void chrome.scripting.executeScript({target: {tabId}, func: scanDocument, args: [targetPostId]})
          .then(([injection]) => {
            if (documentId && injection?.documentId !== documentId) reject(new Error(pageMovedMessage));
            else if (injection?.result) resolve(injection.result);
            else reject(new Error("Xの投稿を読み取れませんでした。"));
          }, error => reject(scanError(error, "Xの投稿を読み取れませんでした。")));
      }, signal);
    }
    if (result.url.split("#")[0] !== sourceUrl.split("#")[0]) throw new Error(pageMovedMessage);
    const extra = await bounded<XMediaCandidate[]>((resolve, reject) => {
      void chrome.scripting.executeScript({target: {tabId}, world: "MAIN", func: scanXMedia, args: targetPostId ? [targetPostId] : []})
        .then(([injection]) => {
          if (documentId && injection?.documentId !== documentId) reject(new Error(pageMovedMessage));
          else resolve(injection?.result ?? []);
        }, () => reject(new Error("Xの動画情報を読み取れませんでした。")));
    }, signal);
    result.media = mergeMediaCandidates(result.media ?? [], extra);
    const isProfileImage = (url: string): boolean => {
      try { return /\/profile_(?:images|banners)\//i.test(new URL(url).pathname); }
      catch { return false; }
    };
    if (isPost) {
      result.images = result.images.filter(url => !isProfileImage(url));
      result.media = result.media.filter(item => !isProfileImage(item.url));
    }
    if (expectVideo && !result.media.some(item => item.kind === "video")) {
      throw new Error("動画は表示されていますが、保存できるMP4のURLを取得できませんでした。");
    }
  }
  await bounded<void>((resolve, reject) => {
    void chrome.tabs.get(tabId).then(tab => {
      if (tab.status === "loading" || (tab.url && tab.url.split("#")[0] !== sourceUrl.split("#")[0])) {
        reject(new Error(pageMovedMessage));
      } else resolve();
    }, () => reject(new Error("解析中のタブが閉じられました。")));
  }, signal);
  return result;
}

export async function scanUrl(url: string, signal?: AbortSignal): Promise<PageScan> {
  if (signal?.aborted) throw new Error("ページの解析を終了しました。");
  // Wait for create to settle so a window created after cancellation can still be closed.
  const window = await chrome.windows.create({
    url,
    focused: false,
    state: "minimized",
    type: "normal",
  });
  const windowId = window?.id;
  const tabId = window?.tabs?.[0]?.id;
  try {
    if (signal?.aborted) throw new Error("ページの解析を終了しました。");
    if (windowId === undefined || tabId === undefined) throw new Error("指定したページを開けませんでした。");
    await bounded<void>((resolve, reject) => {
      const onUpdated = (id: number, change: {status?: string}): void => {
        if (id === tabId && change.status === "complete") resolve();
      };
      const onRemoved = (id: number): void => {
        if (id === tabId) reject(new Error("解析中のタブが閉じられました。"));
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
      void chrome.tabs.get(tabId).then(current => {
        if (current.status === "complete") resolve();
      }, () => reject(new Error("指定したページを開けませんでした。")));
      return () => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
      };
    }, signal);
    return await scanTab(tabId, signal, url);
  } finally {
    if (windowId !== undefined) await chrome.windows.remove(windowId).catch(() => undefined);
  }
}
