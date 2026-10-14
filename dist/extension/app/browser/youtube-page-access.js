import { selectYoutubeFormats, youtubeVideoId, youtubeVideoUrl } from "../../core/youtube.js";
import { readYoutubePage } from "../content/youtube-page.js";
import { manageYoutubeFrame } from "../content/youtube-frame.js";
import { controlYoutubeCapture } from "../content/youtube-capture-control.js";
import { isYoutubePageEvidence } from "../contracts/youtube-contracts.js";
/** Reuse a matching watch page or own a disposable frame without opening tabs. */
export async function acquireYoutubeEvidence(videoId, capture, signal) {
    signal?.throwIfAborted();
    youtubeVideoUrl(videoId);
    const tabs = await chrome.tabs.query({});
    signal?.throwIfAborted();
    const web = tabs.filter(tab => tab.id !== undefined && tab.url?.startsWith("https://"));
    const existing = web.filter(tab => { try {
        const url = new URL(tab.url);
        return url.origin === "https://www.youtube.com" && url.pathname === "/watch" && youtubeVideoId(url.href) === videoId;
    }
    catch {
        return false;
    } })
        .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)))[0];
    if (existing?.id !== undefined)
        return readExistingYoutube(existing.id, videoId, signal, capture);
    const tab = web.find(tab => { try {
        return new URL(tab.url).origin === "https://www.youtube.com";
    }
    catch {
        return false;
    } })
        ?? web.find(tab => tab.active) ?? web[0];
    if (tab?.id === undefined)
        throw new Error("YouTubeの取得にはWebページを開いたタブが必要です。");
    const tabId = tab.id, owner = `harvest-youtube-${crypto.randomUUID()}`;
    let parentDocument, parentUrl, timeout;
    let stopped = false, reject;
    const interrupted = new Promise((_, no) => { reject = no; });
    const stop = (error) => { stopped = true; reject(error); };
    const abort = () => stop(new Error("ページの解析を終了しました。"));
    const removed = (id) => { if (id === tabId)
        stop(new Error("解析中のタブが閉じられました。")); };
    const moved = (id, change) => { if (id === tabId && change.status === "loading")
        stop(new Error("解析中にページが移動しました。もう一度解析してください。")); };
    signal?.addEventListener("abort", abort, { once: true });
    chrome.tabs.onRemoved.addListener(removed);
    chrome.tabs.onUpdated.addListener(moved);
    timeout = setTimeout(() => stop(new Error("YouTubeの動画情報の読み取りが時間切れになりました。")), 90000);
    const operation = (async () => {
        const [created] = await chrome.scripting.executeScript({ target: { tabId }, func: manageYoutubeFrame, args: [videoId, owner, false] });
        parentDocument = created?.documentId;
        parentUrl = created?.result;
        if (stopped || signal?.aborted)
            return undefined;
        if (!parentDocument || typeof parentUrl !== "string")
            throw new Error("YouTubeの動画情報を確認できませんでした。");
        while (!stopped) {
            const entries = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", func: readYoutubePage, args: [videoId, capture, owner] });
            if (stopped || signal?.aborted)
                return undefined;
            const entry = entries.find(row => row.result !== undefined && row.result !== null);
            if (entry) {
                if (!entry.documentId || !isYoutubePageEvidence(entry.result) || entry.result.videoId !== videoId)
                    throw new Error("YouTubeの動画情報を確認できませんでした。");
                if (entry.result.error)
                    throw new Error(entry.result.error);
                const [now] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.href });
                if (stopped || now?.documentId !== parentDocument || now?.result !== parentUrl)
                    throw new Error("解析中にページが移動しました。もう一度解析してください。");
                const frames = await chrome.scripting.executeScript({ target: { tabId, documentIds: [entry.documentId] }, world: "MAIN", func: (name) => window.name === name || location.hash === `#${name}`, args: [owner] });
                if (stopped || frames[0]?.documentId !== entry.documentId || frames[0]?.result !== true)
                    throw new Error("解析中にページが移動しました。もう一度解析してください。");
                return entry.result;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return undefined;
    })();
    try {
        if (signal?.aborted)
            abort();
        const evidence = await Promise.race([operation, interrupted]);
        if (!evidence)
            throw new Error("ページの解析を終了しました。");
        return evidence;
    }
    finally {
        stopped = true;
        if (timeout)
            clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        chrome.tabs.onRemoved.removeListener(removed);
        chrome.tabs.onUpdated.removeListener(moved);
        const cleanup = async () => {
            try {
                if (parentDocument)
                    await chrome.scripting.executeScript({ target: { tabId, documentIds: [parentDocument] }, func: manageYoutubeFrame, args: [videoId, owner, true] });
            }
            catch { /* The owning document may already be gone. */ }
        };
        // A stuck Chrome request must not defeat cancellation or the read deadline.
        // Creation that finishes later still owns a cleanup continuation.
        if (!parentDocument)
            void operation.then(cleanup, cleanup);
        else
            await new Promise(resolve => {
                const timer = setTimeout(resolve, 1000);
                void cleanup().finally(() => { clearTimeout(timer); resolve(); });
            });
    }
}
/** Reuse an open player; capture restores playback and never loads a nested watch page. */
async function readExistingYoutube(tabId, videoId, signal, capture = false) {
    const requestOwner = capture ? `harvest-youtube-${crypto.randomUUID()}` : undefined;
    let captureDocument;
    const release = async () => {
        try {
            if (requestOwner && captureDocument)
                await chrome.scripting.executeScript({ target: { tabId, documentIds: [captureDocument] }, world: "MAIN", func: controlYoutubeCapture, args: [requestOwner, false] });
        }
        catch { /* A closed or replaced document needs no cancellation. */ }
    };
    let timeout, reject;
    const interrupted = new Promise((_, no) => { reject = no; });
    let stopped = false;
    const stop = (error) => { stopped = true; reject(error); };
    const abort = () => stop(new Error("ページの解析を終了しました。"));
    const removed = (id) => { if (id === tabId)
        stop(new Error("解析中のタブが閉じられました。")); };
    signal?.addEventListener("abort", abort, { once: true });
    chrome.tabs.onRemoved.addListener(removed);
    timeout = setTimeout(() => stop(new Error("YouTubeの動画情報の読み取りが時間切れになりました。")), capture ? 45000 : 20000);
    try {
        if (signal?.aborted)
            abort();
        const operation = (async () => {
            if (stopped)
                throw new Error("ページの解析を終了しました。");
            if (requestOwner) {
                const [ready] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: controlYoutubeCapture, args: [requestOwner, true] });
                captureDocument = ready?.documentId;
                if (stopped) {
                    void release();
                    throw new Error("ページの解析を終了しました。");
                }
                if (!captureDocument || youtubeVideoId(String(ready?.result)) !== videoId)
                    throw new Error("解析中にページが移動しました。もう一度解析してください。");
            }
            const [entry] = await chrome.scripting.executeScript({ target: captureDocument ? { tabId, documentIds: [captureDocument] } : { tabId }, world: "MAIN", func: readYoutubePage, args: requestOwner ? [videoId, true, "", true, requestOwner] : [videoId, false] });
            if (stopped)
                throw new Error("ページの解析を終了しました。");
            if (!entry?.documentId || !isYoutubePageEvidence(entry.result) || entry.result.videoId !== videoId)
                throw new Error("YouTubeの動画情報を確認できませんでした。");
            if (entry.result.error)
                throw new Error(entry.result.error);
            const [now] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.href });
            if (stopped || now?.documentId !== entry.documentId || youtubeVideoId(String(now?.result)) !== videoId)
                throw new Error("解析中にページが移動しました。もう一度解析してください。");
            return entry.result;
        })();
        return await Promise.race([operation, interrupted]);
    }
    finally {
        stopped = true;
        if (timeout)
            clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        chrome.tabs.onRemoved.removeListener(removed);
        void release();
    }
}
export async function scanYoutube(videoId, signal) {
    const evidence = await acquireYoutubeEvidence(videoId, false, signal);
    const { video, audio } = selectYoutubeFormats(evidence.formats);
    const total = video.contentLength + audio.contentLength;
    const youtube = { videoId, quality: `${video.height}p${video.fps > 30 ? video.fps : ""}`, ...(video.contentLength && audio.contentLength ? { bytes: total } : {}) };
    const url = youtubeVideoUrl(videoId);
    return { url, title: evidence.title, images: [], media: [{ url, kind: "video", youtube, ...(evidence.previewUrl ? { previewUrl: evidence.previewUrl } : {}) }] };
}
