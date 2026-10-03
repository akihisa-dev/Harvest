import { scanDocument, type PageScan } from "./page-scan.js";
import { waitForXPage, type XPageState } from "./x-page-state.js";
import { scanXMedia } from "./x-media-scan.js";
import type { XMediaSnapshot } from "../core/x-media.js";

const pageMovedMessage = "解析中にページが移動しました。もう一度解析してください。";
const abortedMessage = "ページの解析を終了しました。";
const closedMessage = "解析中のタブが閉じられました。";

/** Each Chrome operation owns its deadline, abort listener, and event cleanup. */
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
    const onAbort = (): void => finish(new Error(abortedMessage));
    const timer = setTimeout(() => finish(new Error("ページの読み取りが時間切れになりました。もう一度お試しください。")), 20_000);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, {once: true});
    try {
      cleanup = start(value => finish(undefined, value), error => finish(error));
      if (settled) cleanup?.();
    } catch {
      finish(new Error("ページを読み取れませんでした。"));
    }
  });
}

interface ScriptRead<T, A extends unknown[], R> {
  readonly func: (...args: A) => T;
  readonly args?: A;
  readonly world?: "MAIN";
  readonly failureMessage: string;
  readonly preserveNavigationError?: boolean;
  readonly watchRemoval?: boolean;
  readonly accept: (result: Awaited<T> | undefined, documentId: string | undefined) => R;
}

/** Owns the identity of the first document read and every later Chrome boundary. */
export class PageReadSession {
  private documentId: string | undefined;
  private sourceUrl = "";

  constructor(private readonly tabId: number, private readonly signal?: AbortSignal) {}

  private read<T, A extends unknown[], R>(request: ScriptRead<T, A, R>): Promise<R> {
    return bounded<R>((resolve, reject) => {
      const onRemoved = (id: number): void => {
        if (id === this.tabId) reject(new Error(closedMessage));
      };
      if (request.watchRemoval) chrome.tabs.onRemoved.addListener(onRemoved);
      void chrome.scripting.executeScript({
        target: {tabId: this.tabId}, func: request.func,
        ...(request.args ? {args: request.args} : {}),
        ...(request.world ? {world: request.world} : {}),
      }).then(([injection]) => {
        if (this.documentId && injection?.documentId !== this.documentId) {
          reject(new Error(pageMovedMessage));
          return;
        }
        try { resolve(request.accept(injection?.result, injection?.documentId)); }
        catch (error) { reject(error instanceof Error ? error : new Error(request.failureMessage)); }
      }, error => reject(new Error(
        request.preserveNavigationError !== false && error instanceof Error
          && error.message.includes("解析中にページが移動しました") ? pageMovedMessage : request.failureMessage,
      )));
      if (request.watchRemoval) return () => chrome.tabs.onRemoved.removeListener(onRemoved);
      return undefined;
    }, this.signal);
  }

  scanInitialPage(): Promise<PageScan> {
    return this.read({
      func: scanDocument,
      watchRemoval: true,
      failureMessage: "このページを読み取れませんでした。Chromeで開けるWebページを指定してください。",
      accept: (result, documentId) => {
        if (!result) throw new Error("ページを読み取れませんでした。");
        this.documentId = documentId;
        this.sourceUrl = result.url;
        return result;
      },
    });
  }

  waitForPost(expectVideo: boolean, targetPostId?: string): Promise<XPageState> {
    return this.read({
      func: waitForXPage, args: targetPostId ? [expectVideo, 10_000, targetPostId] : [expectVideo, 10_000],
      failureMessage: "Xの投稿を読み取れませんでした。",
      accept: result => {
        if (!result) throw new Error("Xの投稿を読み取れませんでした。");
        return result;
      },
    });
  }

  scanPost(targetPostId?: string): Promise<PageScan> {
    return this.read({
      func: scanDocument, args: targetPostId ? [targetPostId] : [],
      failureMessage: "Xの投稿を読み取れませんでした。",
      accept: result => {
        if (!result) throw new Error("Xの投稿を読み取れませんでした。");
        return result;
      },
    });
  }

  scanPostMedia(targetPostId?: string, onlyPostKeys?: string[]): Promise<XMediaSnapshot> {
    return this.read({
      func: scanXMedia, args: onlyPostKeys ? [targetPostId ?? null, onlyPostKeys] : targetPostId ? [targetPostId] : [], world: "MAIN",
      failureMessage: "Xの動画情報を読み取れませんでした。",
      accept: result => {
        if (!result) throw new Error("Xの動画情報を読み取れませんでした。");
        this.assertSourceUrl(result.url);
        return result;
      },
    });
  }

  waitForMediaRetry(): Promise<void> {
    return bounded<void>(resolve => {
      const timer = setTimeout(() => resolve(), 400);
      return () => clearTimeout(timer);
    }, this.signal);
  }

  assertSourceUrl(url: string): void {
    if (url.split("#")[0] !== this.sourceUrl.split("#")[0]) throw new Error(pageMovedMessage);
  }

  verifyCurrentPage(): Promise<void> {
    return bounded<void>((resolve, reject) => {
      void chrome.tabs.get(this.tabId).then(tab => {
        try {
          if (tab.status === "loading") throw new Error(pageMovedMessage);
          if (tab.url) this.assertSourceUrl(tab.url);
          resolve();
        } catch (error) { reject(error as Error); }
      }, () => reject(new Error(closedMessage)));
    }, this.signal);
  }
}

/** Keeps a temporary window alive until its reader settles, including cancellation. */
export async function withTemporaryPage<T>(url: string, signal: AbortSignal | undefined,
  read: (tabId: number) => Promise<T>): Promise<T> {
  if (signal?.aborted) throw new Error(abortedMessage);
  // Wait for create to settle so a window created after cancellation can still be closed.
  const window = await chrome.windows.create({url, focused: false, state: "minimized", type: "normal"});
  const windowId = window?.id;
  const tabId = window?.tabs?.[0]?.id;
  try {
    if (signal?.aborted) throw new Error(abortedMessage);
    if (windowId === undefined || tabId === undefined) throw new Error("指定したページを開けませんでした。");
    await bounded<void>((resolve, reject) => {
      const onUpdated = (id: number, change: {status?: string}): void => {
        if (id === tabId && change.status === "complete") resolve();
      };
      const onRemoved = (id: number): void => {
        if (id === tabId) reject(new Error(closedMessage));
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
    return await read(tabId);
  } finally {
    if (windowId !== undefined) await chrome.windows.remove(windowId).catch(() => undefined);
  }
}
