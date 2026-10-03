import { parseXMedia, xMediaUrlKey, xOriginalPhotoUrl } from "../../core/x-media.js";
import { mergeMediaCandidates } from "../../core/media-selection.js";
import { PageReadSession, withTemporaryPage } from "./page-read-session.js";
const isXUrl = (url) => /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url);
export async function scanTab(tabId, signal, requestedUrl) {
    const session = new PageReadSession(tabId, signal);
    let result = await session.scanInitialPage();
    if (isXUrl(result.url)) {
        const targetUrl = requestedUrl && isXUrl(requestedUrl)
            ? requestedUrl : result.url;
        const expectVideo = /\/status\/\d+\/video\/\d+(?:[?#]|$)/i.test(targetUrl);
        const targetPostId = /\/status\/(\d+)(?:[/?#]|$)/i.exec(targetUrl)?.[1];
        const isBookmarkPage = /^\/i\/(?:history|bookmarks)(?:\/|$)/i.test(new URL(result.url).pathname);
        let snapshot = isBookmarkPage ? await session.scanPostMedia() : undefined;
        if (targetPostId || (isBookmarkPage && !snapshot?.posts.length)) {
            const state = await session.waitForPost(expectVideo, targetPostId);
            if (state.status === "restricted")
                throw new Error("Xがこの投稿の表示を制限しています。Chromeで投稿を表示できる状態にしてから解析してください。");
            if (state.status === "unavailable")
                throw new Error("Xの投稿が削除されているか、表示できません。");
            if (state.status !== "ready")
                throw new Error("Xの投稿の読み込みが完了しませんでした。Chromeで投稿を開いてから解析し直してください。");
            result = await session.scanPost(targetPostId);
            snapshot = undefined;
        }
        session.assertSourceUrl(result.url);
        snapshot ??= await session.scanPostMedia(targetPostId);
        let analysis = parseXMedia(snapshot, targetPostId);
        if (!analysis.diagnostics.limited && analysis.missingPosts.length) {
            await session.waitForMediaRetry();
            const retry = await session.scanPostMedia(targetPostId, analysis.missingPosts);
            const replacements = new Map(retry.posts.map(post => [post.key, post]));
            snapshot = { ...snapshot, limited: retry.limited,
                posts: snapshot.posts.map(post => {
                    const replacement = replacements.get(post.key);
                    if (!replacement)
                        return post;
                    // A disappearing thumbnail during a retry must not erase evidence of
                    // a missing video. Keep the first read and supplement it atomically.
                    const observed = new Map([...post.observed, ...replacement.observed].map(item => [JSON.stringify(item), item]));
                    return { ...post, observed: [...observed.values()], roots: [...post.roots, ...replacement.roots] };
                }) };
            analysis = parseXMedia(snapshot, targetPostId);
        }
        if (!analysis.media.length && analysis.diagnostics.limited)
            throw new Error("Xの投稿情報を読み取りきれず、画像・動画を取得できませんでした。");
        if (!analysis.media.length && analysis.missingPosts.length)
            throw new Error("Xの表示中の画像または動画を一部取得できませんでした。投稿を表示してから解析し直してください。");
        result.xDiagnostics = analysis.diagnostics;
        if (targetPostId || isBookmarkPage) {
            if (!snapshot.posts.length)
                throw new Error("Xの投稿を読み取れませんでした。");
            // The scoped snapshot is authoritative: page-wide decorations must not
            // stand in for missing post media, even when the first DOM scan found them.
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
            // Keep page-wide candidates, but replace confirmed post-photo renditions
            // before filtering supplements so their original URL is not discarded.
            result.images = [...new Set(result.images.filter(url => !posters.has(xMediaUrlKey(url))).map(confirmedPhotoUrl))];
            const known = new Set(result.images.map(xMediaUrlKey));
            const media = (result.media ?? []).filter(item => item.kind === "video" || !posters.has(xMediaUrlKey(item.url)))
                .map(item => item.kind === "image" ? { ...item, url: confirmedPhotoUrl(item.url) } : item);
            result.media = mergeMediaCandidates(media, analysis.media.filter(item => item.kind !== "image" || !known.has(xMediaUrlKey(item.url))));
        }
        if (expectVideo && !result.media.some(item => item.kind === "video")) {
            throw new Error("動画は表示されていますが、保存できるMP4のURLを取得できませんでした。");
        }
    }
    await session.verifyCurrentPage();
    return result;
}
export function scanUrl(url, signal) {
    return withTemporaryPage(url, signal, tabId => scanTab(tabId, signal, url));
}
