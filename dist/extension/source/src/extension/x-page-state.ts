export interface XPageState {
  status: "ready" | "restricted" | "unavailable" | "timeout";
}

/** Wait for X's post/player DOM rather than the browser's initial load event. */
export async function waitForXPage(expectVideo: boolean, timeoutMs = 10_000, targetPostId?: string): Promise<XPageState> {
  // These DOM helpers stay inside the injected function: Chrome copies only its body.
  const quoteSelector = '[data-testid="quoteTweet"], [data-testid="quotedTweet"], [role="link"]:not(a):has(a[href*="/status/"])';
  const ownPostId = (root: Element): string | undefined => {
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].filter(link => {
      if (link.parentElement?.closest(quoteSelector)) return false;
      const article = link.closest("article");
      return root.tagName.toLowerCase() === "article" ? article === root
        : !article && link.closest('dialog, [role="dialog"]') === root;
    });
    const permalink = links.find(link => link.querySelector("time"))
      ?? (root.tagName.toLowerCase() === "article" ? undefined : links[0]);
    if (!permalink) return undefined;
    try {
      const url = new URL(permalink.href, location.href);
      return /^(?:www\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname)
        ? /\/status\/(\d+)(?:\/|$)/i.exec(url.pathname)?.[1] : undefined;
    } catch { return undefined; }
  };
  const inTargetPost = (element: Element): boolean => {
    if (!targetPostId) return true;
    if (element.closest(quoteSelector)) return false;
    const article = element.closest("article");
    if (article) return ownPostId(article) === targetPostId;
    const dialog = element.closest('dialog, [role="dialog"]');
    return Boolean(dialog && ownPostId(dialog) === targetPostId);
  };
  const deadline = performance.now() + Math.min(Math.max(timeoutMs, 1), 10_000);
  let readySince: number | undefined;
  while (performance.now() < deadline) {
    const root = document.querySelector("main") ?? document.body;
    // Status text inside any post is user content, including replies and quotes.
    const statusRoot = targetPostId ? root?.cloneNode(true) as HTMLElement | undefined : undefined;
    statusRoot?.querySelectorAll('article, script, style, [data-testid="tweetText"], [data-testid="quoteTweet"], [data-testid="quotedTweet"]')
      .forEach(element => element.remove());
    const text = targetPostId ? statusRoot?.textContent ?? "" : root?.innerText ?? "";
    const player = targetPostId
      ? [...document.querySelectorAll('video, [data-testid="videoPlayer"]')].find(inTargetPost)
      : document.querySelector('video, [data-testid="videoPlayer"]');
    const post = targetPostId
      ? [...document.querySelectorAll('article[data-testid="tweet"]')].find(inTargetPost)
      : document.querySelector('article[data-testid="tweet"]');
    if (!player && !post && /このポストはXアプリでのみ表示できます|This (?:Post|post) is only available (?:on|in) the X app|This (?:Post|post) is unavailable|このポストは表示できません|このポストを表示できません/i.test(text)) {
      return {status: "restricted"};
    }
    if (!player && !post && /このポストは削除されました|このポストは存在しません|This (?:Post|post) was deleted|This (?:Post|post) does(?:n.t| not) exist/i.test(text)) {
      return {status: "unavailable"};
    }
    const ready = expectVideo ? Boolean(player) : Boolean(post || player);
    if (ready) {
      readySince ??= performance.now();
      if (performance.now() - readySince >= 400) return {status: "ready"};
    } else readySince = undefined;
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  return {status: "timeout"};
}
