import { selectYoutubeFormats, youtubeStreamingUrl } from "../../core/youtube.js";
import { YoutubeSabrSession, youtubeAuthenticationError } from "../../core/youtube-sabr.js";
import { acquireYoutubeEvidence } from "../browser/youtube-page-access.js";
import { checkCancelled, MAX_IMAGE_BYTES } from "../contracts/image-data-contract.js";
import { isMp4ConversionReply } from "../contracts/worker-contracts.js";
import { fetchResponse } from "./response-fetch.js";
import { readImageBytes } from "./image-response-bytes.js";
import { validateOriginalMedia } from "./original-media-validation.js";
const errors = {
    http: status => new Error(status === 401 || status === 403 ? youtubeAuthenticationError : "YouTubeの動画配信が取得を継続できませんでした。"),
    cancelled: () => new Error("メディアの取得を中止しました。"), timeout: () => new Error("メディアの取得がタイムアウトしました。"),
    failure: (error, { signal, sourceSignal }) => sourceSignal?.aborted ? new Error("メディアの取得を中止しました。") : signal.aborted ? new Error("メディアの取得がタイムアウトしました。") : error instanceof Error ? error : new Error("メディアを取得できませんでした。"),
};
function delay(ms, signal) {
    checkCancelled(signal);
    return new Promise((resolve, reject) => {
        const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
        const timer = setTimeout(finish, ms);
        const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new Error("メディアの取得を中止しました。")); };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted)
            abort();
    });
}
export function prepareYoutubeMp4(video, audio, durations, signal) {
    checkCancelled(signal);
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("../workers/youtube-mux-worker.js", import.meta.url), { type: "module" });
        let settled = false;
        const finish = (error, blob) => { if (settled)
            return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); worker.terminate(); if (error)
            reject(error);
        else if (blob)
            resolve(blob); };
        const abort = () => finish(new Error("メディアの取得を中止しました。"));
        const timer = setTimeout(() => finish(new Error("YouTube動画の結合がタイムアウトしました。")), 120000);
        worker.onmessage = (event) => {
            const reply = event.data;
            if (!isMp4ConversionReply(reply) || reply.error || !reply.blob || reply.blob.size > MAX_IMAGE_BYTES)
                finish(new Error("YouTube動画の映像と音声をまとめられませんでした。"));
            else
                finish(undefined, reply.blob);
        };
        worker.onerror = worker.onmessageerror = () => finish(new Error("YouTube動画の映像と音声をまとめられませんでした。"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
            abort();
            return;
        }
        try {
            worker.postMessage({ video, audio, durations, maxBytes: MAX_IMAGE_BYTES });
        }
        catch {
            finish(new Error("YouTube動画の映像と音声をまとめられませんでした。"));
        }
    });
}
/** Refresh playback evidence for each save/retry. A failed partial download is never reused across tokens. */
export async function fetchYoutubeVideo(source, signal) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
        checkCancelled(signal);
        try {
            const evidence = await acquireYoutubeEvidence(source.videoId, true, signal);
            if (!evidence.capture)
                throw new Error(youtubeAuthenticationError);
            const { video, audio } = selectYoutubeFormats(evidence.formats);
            if (`${video.height}p${video.fps > 30 ? video.fps : ""}` !== source.quality)
                throw new Error("YouTube動画の画質情報が変わりました。もう一度解析してください。");
            const session = new YoutubeSabrSession(source.videoId, evidence.capture.url, new Uint8Array(evidence.capture.body), video, audio, MAX_IMAGE_BYTES);
            const started = performance.now();
            let lastProgressAt = started, totalTransferred = 0;
            for (let request = 0; request < 2048 && !session.complete; request++) {
                checkCancelled(signal);
                if (performance.now() - started > 120000)
                    throw new Error("メディアの取得がタイムアウトしました。");
                const before = session.receivedBytes, endpoint = new URL(youtubeStreamingUrl(session.url));
                endpoint.searchParams.set("alr", "no");
                endpoint.searchParams.set("rn", String(request));
                const bytes = await fetchResponse(endpoint.href, { method: "POST", body: session.request(Math.round(performance.now() - started)), timeoutMs: Math.min(30000, Math.max(1, 120000 - (performance.now() - started))), ...(signal ? { signal } : {}) }, errors, async (response) => {
                    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
                    if (type !== "application/vnd.yt-ump" && type !== "application/octet-stream")
                        throw new Error("YouTubeの配信データが不完全または未対応です。");
                    return readImageBytes(response, MAX_IMAGE_BYTES);
                });
                totalTransferred += bytes.length;
                if (totalTransferred > MAX_IMAGE_BYTES * 3)
                    throw new Error("YouTubeの動画配信が取得を継続できませんでした。");
                session.ingest(bytes);
                const progressed = session.receivedBytes > before;
                if (progressed)
                    lastProgressAt = performance.now();
                if (!session.complete && performance.now() - lastProgressAt >= 30000)
                    throw new Error("YouTubeの動画配信が取得を継続できませんでした。");
                if (!session.complete)
                    await delay(Math.max(session.backoffMs, progressed ? 0 : 500), signal);
            }
            const output = session.output();
            checkCancelled(signal);
            const blob = await prepareYoutubeMp4(new Blob([output.video], { type: "video/mp4" }), new Blob([output.audio], { type: "audio/mp4" }), output.durations, signal);
            await validateOriginalMedia(blob, signal);
            return blob;
        }
        catch (error) {
            lastError = error;
            if (signal?.aborted || !(error instanceof Error) || error.message !== youtubeAuthenticationError)
                throw error;
        }
    }
    throw lastError;
}
