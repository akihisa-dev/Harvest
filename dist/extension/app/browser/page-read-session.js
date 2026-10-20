import { fetchXBookmarkPage } from "../content/x-bookmark-page.js";
import { isBookmarkPageResult, isPageScan, isXPageState, isXMediaSnapshot } from "../contracts/page-contracts.js";
import { scanDocument } from "../content/page-scan.js";
import { readFrameLocation } from "../content/frame-location.js";
import { waitForXPage } from "../content/x-page-state.js";
import { scanXMedia } from "../content/x-media-scan.js";
import { isStreamRecordingPage, streamDownloadUrl } from "../../core/stream-recording.js";
import { inspectStreamRecording } from "./stream-recording.js";
const pageMovedMessage = "解析中にページが移動しました。もう一度解析してください。";
const abortedMessage = "ページの解析を終了しました。";
const closedMessage = "解析中のタブが閉じられました。";
/** Each Chrome operation owns its deadline, abort listener, and event cleanup. */
function bounded(start, signal, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let cleanup;
        const finish = (error, value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            cleanup?.();
            if (error)
                reject(error);
            else
                resolve(value);
        };
        const onAbort = () => finish(new Error(abortedMessage));
        const timer = setTimeout(() => finish(new Error("ページの読み取りが時間切れになりました。もう一度お試しください。")), timeoutMs);
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            cleanup = start(value => finish(undefined, value), error => finish(error));
            if (settled)
                cleanup?.();
        }
        catch {
            finish(new Error("ページを読み取れませんでした。"));
        }
    });
}
/** Owns the identity of the first document read and every later Chrome boundary. */
export class PageReadSession {
    tabId;
    signal;
    documentId;
    sourceUrl = "";
    bookmarkEpoch;
    bookmarkChanged = false;
    constructor(tabId, signal) {
        this.tabId = tabId;
        this.signal = signal;
    }
    read(request) {
        return bounded((resolve, reject) => {
            const onRemoved = (id) => {
                if (id === this.tabId)
                    reject(new Error(closedMessage));
            };
            if (request.watchRemoval)
                chrome.tabs.onRemoved.addListener(onRemoved);
            void chrome.scripting.executeScript({
                target: { tabId: this.tabId }, func: request.func,
                ...(request.args ? { args: request.args } : {}),
                ...(request.world ? { world: request.world } : {}),
            }).then(([injection]) => {
                if (this.documentId && injection?.documentId !== this.documentId) {
                    reject(new Error(pageMovedMessage));
                    return;
                }
                try {
                    resolve(request.accept(injection?.result, injection?.documentId));
                }
                catch (error) {
                    reject(error instanceof Error ? error : new Error(request.failureMessage));
                }
            }, error => reject(new Error(request.preserveNavigationError !== false && error instanceof Error
                && error.message.includes("解析中にページが移動しました") ? pageMovedMessage : request.failureMessage)));
            if (request.watchRemoval)
                return () => chrome.tabs.onRemoved.removeListener(onRemoved);
            return undefined;
        }, this.signal);
    }
    async scanInitialPage() {
        const page = await this.read({
            func: scanDocument,
            watchRemoval: true,
            failureMessage: "このページを読み取れませんでした。Chromeで開けるWebページを指定してください。",
            accept: (result, documentId) => {
                if (!isPageScan(result))
                    throw new Error("ページを読み取れませんでした。");
                this.documentId = documentId;
                this.sourceUrl = result.url;
                return result;
            },
        });
        return this.scanRecording(page);
    }
    async scanRecording(page) {
        if (!isStreamRecordingPage(page.url))
            return page;
        // A generic Office document viewer must not be mistaken for a recording.
        const url = new URL(page.url);
        const libraryRecording = /\/Forms\/AllItems\.aspx$/i.test(url.pathname) && streamDownloadUrl(page.url) !== null;
        if (!/\/stream\.aspx$/i.test(url.pathname) && !libraryRecording && !/\.mp4(?:$|[?#])/i.test(url.searchParams.get("id") ?? url.searchParams.get("file") ?? "")
            && !page.media?.some(item => item.kind === "video"))
            return page;
        const stream = await inspectStreamRecording(page.url, this.signal);
        const downloadUrl = streamDownloadUrl(page.url);
        return { ...page, images: [], media: [{ url: downloadUrl, kind: "video", stream }], hasFrames: false };
    }
    async scanFrames() {
        try {
            return await bounded((resolve, reject) => {
                let active = true;
                const onRemoved = (id) => {
                    if (id === this.tabId)
                        reject(new Error(closedMessage));
                };
                chrome.tabs.onRemoved.addListener(onRemoved);
                void (async () => {
                    const rawScans = await chrome.scripting.executeScript({
                        target: { tabId: this.tabId, allFrames: true }, func: scanDocument, args: ["", true],
                    });
                    if (!active)
                        return;
                    const scans = await Promise.all(rawScans.map(async (entry) => {
                        if (!isPageScan(entry.result) || !isStreamRecordingPage(entry.result.url))
                            return entry;
                        try {
                            return { ...entry, result: await this.scanRecording(entry.result) };
                        }
                        catch {
                            // An inaccessible recording must not fall back to playback URLs.
                            return { ...entry, result: { ...entry.result, images: [], media: [] } };
                        }
                    }));
                    if (!active)
                        return;
                    // Same-URL reloads and detached frames must not publish stale candidates.
                    const current = await chrome.scripting.executeScript({
                        target: { tabId: this.tabId, allFrames: true }, func: readFrameLocation,
                    });
                    if (!active)
                        return;
                    const frames = scans.filter(entry => entry.frameId !== undefined && entry.frameId !== 0
                        && entry.documentId && isPageScan(entry.result) && entry.result.framePath?.length
                        && current.some(now => now.frameId === entry.frameId && now.documentId === entry.documentId
                            && typeof now.result?.url === "string" && now.result.url.split("#")[0] === entry.result.url.split("#")[0]))
                        .map(entry => {
                        const source = current.find(now => now.frameId === entry.frameId && now.documentId === entry.documentId)?.result?.sourcePage;
                        return { ...entry.result, ...(typeof source === "string" && /^https?:\/\//.test(source) ? { sourcePage: source } : {}) };
                    });
                    frames.sort((a, b) => {
                        const left = a.framePath, right = b.framePath;
                        for (let i = 0; i < Math.min(left.length, right.length); i++) {
                            if (left[i] !== right[i])
                                return left[i] - right[i];
                        }
                        return left.length - right.length;
                    });
                    resolve(frames);
                })().catch(error => reject(error instanceof Error ? error : new Error("Frame scan failed")));
                return () => { active = false; chrome.tabs.onRemoved.removeListener(onRemoved); };
            }, this.signal);
        }
        catch (error) {
            if (this.signal?.aborted)
                throw error;
            // Frame access is optional. The retained main document is verified separately.
            return [];
        }
    }
    waitForPost(expectVideo, targetPostId) {
        return this.read({
            func: waitForXPage, args: targetPostId ? [expectVideo, 10_000, targetPostId] : [expectVideo, 10_000],
            failureMessage: "Xの投稿を読み取れませんでした。",
            accept: result => {
                if (!isXPageState(result))
                    throw new Error("Xの投稿を読み取れませんでした。");
                return result;
            },
        });
    }
    scanPost(targetPostId) {
        return this.read({
            func: scanDocument, args: targetPostId ? [targetPostId] : [],
            failureMessage: "Xの投稿を読み取れませんでした。",
            accept: result => {
                if (!isPageScan(result))
                    throw new Error("Xの投稿を読み取れませんでした。");
                return result;
            },
        });
    }
    scanPostMedia(targetPostId, onlyPostKeys) {
        return this.read({
            func: scanXMedia, args: onlyPostKeys ? [targetPostId ?? null, onlyPostKeys] : targetPostId ? [targetPostId] : [], world: "MAIN",
            failureMessage: "Xの動画情報を読み取れませんでした。",
            accept: result => {
                if (!isXMediaSnapshot(result))
                    throw new Error("Xの動画情報を読み取れませんでした。");
                this.assertSourceUrl(result.url);
                if (!targetPostId && /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/i\/(?:history|bookmarks)(?:[/?#]|$)/i.test(this.sourceUrl)) {
                    this.assertBookmarkEpoch(result);
                    this.bookmarkEpoch ??= result.bookmarkEpoch;
                }
                return result;
            },
        });
    }
    fetchBookmarkPage() {
        return this.read({ func: fetchXBookmarkPage, args: [this.sourceUrl], world: "MAIN",
            failureMessage: "ブックマークの続きを取得できませんでした。",
            accept: value => {
                if (!isBookmarkPageResult(value))
                    throw new Error("ブックマークの続きを取得できませんでした。");
                return value;
            } });
    }
    waitForMediaRetry() {
        return bounded(resolve => {
            const timer = setTimeout(() => resolve(), 400);
            return () => clearTimeout(timer);
        }, this.signal);
    }
    assertSourceUrl(url) {
        if (url.split("#")[0] !== this.sourceUrl.split("#")[0])
            throw new Error(pageMovedMessage);
    }
    assertBookmarkEpoch(snapshot) {
        this.bookmarkChanged ||= this.bookmarkEpoch !== undefined && snapshot.bookmarkEpoch !== this.bookmarkEpoch;
        if (this.bookmarkChanged)
            throw new Error("解析中にブックマーク一覧の取得状態が変わりました。もう一度解析してください。");
    }
    async verifyCurrentPage(checkBookmarkList = false) {
        await bounded((resolve, reject) => {
            void chrome.tabs.get(this.tabId).then(tab => {
                try {
                    if (tab.status === "loading")
                        throw new Error(pageMovedMessage);
                    if (tab.url)
                        this.assertSourceUrl(tab.url);
                    resolve();
                }
                catch (error) {
                    reject(error);
                }
            }, () => reject(new Error(closedMessage)));
        }, this.signal);
        if (this.documentId || (checkBookmarkList && this.bookmarkEpoch !== undefined)) {
            if (checkBookmarkList) {
                await this.read({
                    func: scanXMedia, args: [null, [], true], world: "MAIN",
                    watchRemoval: true,
                    failureMessage: pageMovedMessage,
                    accept: snapshot => {
                        if (!isXMediaSnapshot(snapshot))
                            throw new Error(pageMovedMessage);
                        this.assertSourceUrl(snapshot.url);
                        if (snapshot.bookmarkList === "other")
                            throw new Error(pageMovedMessage);
                        this.assertBookmarkEpoch(snapshot);
                    },
                });
                return;
            }
            await this.read({
                func: () => location.href,
                watchRemoval: true,
                failureMessage: pageMovedMessage,
                accept: url => {
                    if (typeof url !== "string" || !url)
                        throw new Error(pageMovedMessage);
                    this.assertSourceUrl(url);
                },
            });
        }
    }
}
/** Keeps a temporary window alive until its reader settles, including cancellation. */
export async function withTemporaryPage(url, signal, read, loadTimeoutMs = 20_000) {
    if (signal?.aborted)
        throw new Error(abortedMessage);
    // Wait for create to settle so a window created after cancellation can still be closed.
    const window = await chrome.windows.create({ url, focused: false, state: "minimized", type: "normal" });
    const windowId = window?.id;
    const tabId = window?.tabs?.[0]?.id;
    try {
        if (signal?.aborted)
            throw new Error(abortedMessage);
        if (windowId === undefined || tabId === undefined)
            throw new Error("指定したページを開けませんでした。");
        await waitForTemporaryTab(tabId, signal, loadTimeoutMs);
        return await read(tabId);
    }
    finally {
        if (windowId !== undefined)
            await chrome.windows.remove(windowId).catch(() => undefined);
    }
}
function waitForTemporaryTab(tabId, signal, loadTimeoutMs) {
    return bounded((resolve, reject) => {
        const onUpdated = (id, change) => {
            if (id === tabId && change.status === "complete")
                resolve();
        };
        const onRemoved = (id) => {
            if (id === tabId)
                reject(new Error(closedMessage));
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onRemoved.addListener(onRemoved);
        void chrome.tabs.get(tabId).then(current => {
            if (current.status === "complete")
                resolve();
        }, () => reject(new Error("指定したページを開けませんでした。")));
        return () => {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            chrome.tabs.onRemoved.removeListener(onRemoved);
        };
    }, signal, loadTimeoutMs);
}
