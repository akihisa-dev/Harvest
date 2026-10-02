import { mergeMediaCandidates } from "../core/media-selection.js";
import { PageReadSession, withTemporaryPage } from "./page-read-session.js";
const isXUrl = (url) => /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url);
const isProfileImage = (url) => {
    try {
        return /\/profile_(?:images|banners)\//i.test(new URL(url).pathname);
    }
    catch {
        return false;
    }
};
export async function scanTab(tabId, signal, requestedUrl) {
    const session = new PageReadSession(tabId, signal);
    let result = await session.scanInitialPage();
    if (isXUrl(result.url)) {
        const targetUrl = requestedUrl && isXUrl(requestedUrl)
            ? requestedUrl : result.url;
        const expectVideo = /\/status\/\d+\/video\/\d+(?:[?#]|$)/i.test(targetUrl);
        const targetPostId = /\/status\/(\d+)(?:[/?#]|$)/i.exec(targetUrl)?.[1];
        if (targetPostId) {
            const state = await session.waitForPost(expectVideo, targetPostId);
            if (state.status === "restricted")
                throw new Error("Xがこの投稿の表示を制限しています。Chromeで投稿を表示できる状態にしてから解析してください。");
            if (state.status === "unavailable")
                throw new Error("Xの投稿が削除されているか、表示できません。");
            if (state.status !== "ready")
                throw new Error("Xの投稿の読み込みが完了しませんでした。Chromeで投稿を開いてから解析し直してください。");
            result = await session.scanPost(targetPostId);
        }
        session.assertSourceUrl(result.url);
        const extra = await session.scanPostMedia(targetPostId);
        result.media = mergeMediaCandidates(result.media ?? [], extra);
        if (targetPostId) {
            result.images = result.images.filter(url => !isProfileImage(url));
            result.media = result.media.filter(item => !isProfileImage(item.url));
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
