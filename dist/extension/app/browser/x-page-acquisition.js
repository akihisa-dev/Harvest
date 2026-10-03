import { parseXMedia, xMediaUrlKey, xOriginalPhotoUrl } from "../../core/x-media.js";
import { mergeMediaCandidates } from "../../core/media-selection.js";
import { mergeBookmarkSnapshots, supplementXSnapshot } from "./x-scan-evidence.js";
const isXUrl = (url) => /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url);
const pageMovedMessage = "解析中にページが移動しました。もう一度解析してください。";
export function xPageTarget(sourceUrl, requestedUrl) {
    if (!isXUrl(sourceUrl))
        return undefined;
    const targetUrl = requestedUrl && isXUrl(requestedUrl) ? requestedUrl : sourceUrl;
    return {
        expectVideo: /\/status\/\d+\/video\/\d+(?:[?#]|$)/i.test(targetUrl),
        postId: /\/status\/(\d+)(?:[/?#]|$)/i.exec(targetUrl)?.[1],
        bookmarkPage: /^\/i\/(?:history|bookmarks)(?:\/|$)/i.test(new URL(sourceUrl).pathname),
    };
}
/** Owns ordered acquisition and retry decisions; the reader owns Chrome and document identity. */
export async function acquireXPage(session, initial, target, signal, options = {}) {
    let result = initial;
    let snapshot = target.bookmarkPage ? await session.scanPostMedia() : undefined;
    if (target.postId || (target.bookmarkPage && !snapshot?.posts.length)) {
        const state = await session.waitForPost(target.expectVideo, target.postId);
        if (state.status === "restricted")
            throw new Error("Xがこの投稿の表示を制限しています。Chromeで投稿を表示できる状態にしてから解析してください。");
        if (state.status === "unavailable")
            throw new Error("Xの投稿が削除されているか、表示できません。");
        if (state.status !== "ready")
            throw new Error("Xの投稿の読み込みが完了しませんでした。Chromeで投稿を開いてから解析し直してください。");
        result = await session.scanPost(target.postId);
        snapshot = undefined;
    }
    session.assertSourceUrl(result.url);
    snapshot ??= await session.scanPostMedia(target.postId);
    const checkBookmarkList = target.bookmarkPage && !target.postId && snapshot.bookmarkList !== "other";
    let bookmarkIncomplete = false, bookmarkStopped = false;
    if (target.bookmarkPage && !target.postId) {
        bookmarkIncomplete = true;
        const cursors = new Set();
        while (snapshot.bookmarkContinuation && !signal?.aborted) {
            options.onProgress?.(snapshot.posts.length);
            if (options.shouldStop?.()) {
                bookmarkStopped = true;
                break;
            }
            let page;
            try {
                page = await session.fetchBookmarkPage();
            }
            catch {
                break;
            }
            if (page.status === "changed")
                throw new Error(pageMovedMessage);
            if (page.status === "unavailable")
                break;
            // Even a failed continuation can have received usable evidence.
            let next;
            try {
                next = await session.scanPostMedia();
            }
            catch {
                break;
            }
            if (next.bookmarkList === "other")
                throw new Error(pageMovedMessage);
            if (!next.bookmarkContinuation && next.bookmarkList !== "bookmarks")
                break;
            snapshot = mergeBookmarkSnapshots(snapshot, next);
            if (page.status === "end") {
                bookmarkIncomplete = false;
                break;
            }
            if (page.status !== "advanced" || !page.cursor || cursors.has(page.cursor))
                break;
            cursors.add(page.cursor);
        }
    }
    let analysis = parseXMedia(snapshot, target.postId);
    if (!analysis.diagnostics.limited && analysis.missingPosts.length) {
        await session.waitForMediaRetry();
        const retry = await session.scanPostMedia(target.postId, analysis.missingPosts);
        snapshot = supplementXSnapshot(snapshot, retry);
        analysis = parseXMedia(snapshot, target.postId);
    }
    applyAnalysis(result, snapshot, analysis, target, bookmarkIncomplete, bookmarkStopped);
    return { result, checkBookmarkList };
}
/** Reconcile scoped post media and page-wide candidates without changing their precedence. */
function applyAnalysis(result, snapshot, analysis, target, bookmarkIncomplete, bookmarkStopped) {
    if (!analysis.media.length && analysis.diagnostics.limited)
        throw new Error("Xの投稿情報を読み取りきれず、画像・動画を取得できませんでした。");
    if (!analysis.media.length && analysis.missingPosts.length)
        throw new Error("Xの表示中の画像または動画を一部取得できませんでした。投稿を表示してから解析し直してください。");
    result.xDiagnostics = { ...analysis.diagnostics, ...(bookmarkIncomplete ? { bookmarkIncomplete: true } : {}), ...(bookmarkStopped ? { bookmarkStopped: true } : {}) };
    if (target.postId || target.bookmarkPage) {
        if (!snapshot.posts.length)
            throw new Error("Xの投稿を読み取れませんでした。");
        // Scoped evidence is authoritative; decorations cannot replace absent post media.
        result.images = analysis.media.filter(item => item.kind === "image").map(item => item.url);
        result.media = mergeMediaCandidates([], analysis.media);
    }
    else {
        const posters = new Set(analysis.media.filter(item => item.kind === "video" && item.previewUrl)
            .map(item => xMediaUrlKey(item.previewUrl)));
        const photos = new Map(analysis.media.filter(item => item.kind === "image").map(item => [xMediaUrlKey(item.url), item.url]));
        const confirmedPhotoUrl = (url) => {
            const original = xOriginalPhotoUrl(url);
            return photos.get(xMediaUrlKey(url)) === original ? original : url;
        };
        // Replace confirmed renditions before filtering supplements, preserving original URLs.
        result.images = [...new Set(result.images.filter(url => !posters.has(xMediaUrlKey(url))).map(confirmedPhotoUrl))];
        const known = new Set(result.images.map(xMediaUrlKey));
        const media = (result.media ?? []).filter(item => item.kind === "video" || !posters.has(xMediaUrlKey(item.url)))
            .map(item => item.kind === "image" ? { ...item, url: confirmedPhotoUrl(item.url) } : item);
        result.media = mergeMediaCandidates(media, analysis.media.filter(item => item.kind !== "image" || !known.has(xMediaUrlKey(item.url))));
    }
    if (target.expectVideo && !result.media.some(item => item.kind === "video")) {
        throw new Error("動画は表示されていますが、保存できるMP4のURLを取得できませんでした。");
    }
}
