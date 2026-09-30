/** Wait for X's post/player DOM rather than the browser's initial load event. */
export async function waitForXPage(expectVideo, timeoutMs = 10_000) {
    const deadline = performance.now() + Math.min(Math.max(timeoutMs, 1), 10_000);
    let readySince;
    while (performance.now() < deadline) {
        const root = document.querySelector("main") ?? document.body;
        const text = root?.innerText ?? "";
        const player = document.querySelector('video, [data-testid="videoPlayer"]');
        const post = document.querySelector('article[data-testid="tweet"]');
        if (!player && !post && /このポストはXアプリでのみ表示できます|This (?:Post|post) is only available (?:on|in) the X app|This (?:Post|post) is unavailable|このポストは表示できません|このポストを表示できません/i.test(text)) {
            return { status: "restricted" };
        }
        if (!player && !post && /このポストは削除されました|このポストは存在しません|This (?:Post|post) was deleted|This (?:Post|post) does(?:n.t| not) exist/i.test(text)) {
            return { status: "unavailable" };
        }
        const ready = expectVideo ? Boolean(player) : Boolean(post || player);
        if (ready) {
            readySince ??= performance.now();
            if (performance.now() - readySince >= 400)
                return { status: "ready" };
        }
        else
            readySince = undefined;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { status: "timeout" };
}
