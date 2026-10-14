import { selectYoutubeFormats, youtubeVideoUrl } from "../../core/youtube.js";
import { readYoutubePage } from "../content/youtube-page.js";
import { isYoutubePageEvidence } from "../contracts/youtube-contracts.js";
import { withTemporaryTab } from "./page-read-session.js";
/** Observe playback only in an owned inactive tab, which is closed on every exit. */
export async function acquireYoutubeEvidence(videoId, capture, signal) {
    return withTemporaryTab(youtubeVideoUrl(videoId), signal, async (tabId) => {
        const controller = new AbortController();
        let timeout;
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        let reject;
        const interrupted = new Promise((_, no) => { reject = no; });
        const stop = () => reject(new Error("ページの解析を終了しました。"));
        controller.signal.addEventListener("abort", stop, { once: true });
        const removed = (id) => { if (id === tabId)
            reject(new Error("解析中のタブが閉じられました。")); };
        chrome.tabs.onRemoved.addListener(removed);
        timeout = setTimeout(() => reject(new Error("YouTubeの動画情報の読み取りが時間切れになりました。")), 20000);
        try {
            signal?.throwIfAborted();
            const operation = (async () => {
                const [entry] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readYoutubePage, args: [videoId, capture] });
                signal?.throwIfAborted();
                if (!entry?.documentId || !isYoutubePageEvidence(entry.result) || entry.result.videoId !== videoId)
                    throw new Error("YouTubeの動画情報を確認できませんでした。");
                if (entry.result.error)
                    throw new Error(entry.result.error);
                const [now] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.href });
                if (now?.documentId !== entry.documentId || now?.result !== youtubeVideoUrl(videoId))
                    throw new Error("解析中にページが移動しました。もう一度解析してください。");
                return entry.result;
            })();
            return await Promise.race([operation, interrupted]);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
            controller.signal.removeEventListener("abort", stop);
            chrome.tabs.onRemoved.removeListener(removed);
        }
    }, 90000);
}
export async function scanYoutube(videoId, signal) {
    const evidence = await acquireYoutubeEvidence(videoId, false, signal);
    const { video, audio } = selectYoutubeFormats(evidence.formats);
    const total = video.contentLength + audio.contentLength;
    const youtube = { videoId, quality: `${video.height}p${video.fps > 30 ? video.fps : ""}`, ...(video.contentLength && audio.contentLength ? { bytes: total } : {}) };
    const url = youtubeVideoUrl(videoId);
    return { url, title: evidence.title, images: [], media: [{ url, kind: "video", youtube, ...(evidence.previewUrl ? { previewUrl: evidence.previewUrl } : {}) }] };
}
