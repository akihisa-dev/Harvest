/** A disposable player inside an existing page, never a tab or window. */
export function manageYoutubeFrame(videoId, owner, remove) {
    if (!/^[\w-]{11}$/.test(videoId) || !/^harvest-youtube-[\w-]+$/.test(owner))
        throw new Error("YouTubeの対象動画を確認できませんでした。");
    const existing = document.getElementById(owner);
    if (remove) {
        if (existing?.tagName === "IFRAME" && existing.getAttribute("name") === owner)
            existing.remove();
        return location.href;
    }
    if (existing || !document.body)
        throw new Error("YouTubeの動画プレイヤーを読み取れませんでした。");
    const frame = document.createElement("iframe");
    frame.id = owner;
    frame.name = owner;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("allow", "autoplay");
    frame.style.cssText = "position:fixed!important;left:-20000px!important;top:0!important;width:1280px!important;height:720px!important;opacity:0!important;pointer-events:none!important;border:0!important;";
    // Preserve the native watch authorization path for videos which the embedded
    // player cannot play. An already-open video's analysis never creates a frame.
    const sameOrigin = location.origin === "https://www.youtube.com";
    const url = new URL(sameOrigin ? "/watch" : `/embed/${videoId}`, "https://www.youtube.com");
    if (sameOrigin)
        url.searchParams.set("v", videoId);
    else
        url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("autoplay", "0");
    url.searchParams.set("mute", "1");
    url.hash = owner;
    frame.src = url.href;
    document.body.append(frame);
    return location.href;
}
