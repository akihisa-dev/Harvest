export interface XMediaCandidate {
  url: string;
  kind: "video";
  previewUrl?: string;
}

/**
 * Read video URLs from data already attached to X/Twitter posts and players.
 *
 * This function is passed directly to chrome.scripting.executeScript in the
 * page's MAIN world. Keep every helper inside it so it remains serializable.
 */
export function scanXMedia(targetPostId?: string): XMediaCandidate[] {
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
  const hostname = location.hostname.toLowerCase();
  if (!(hostname === "x.com" || hostname.endsWith(".x.com")
    || hostname === "twitter.com" || hostname.endsWith(".twitter.com"))) return [];

  const deadline = performance.now() + 2_500;
  const maxArticles = 60;
  const maxMediaElements = 40;
  const maxNodes = 18_000;
  const maxDepth = 36;
  let visitedNodes = 0;
  const resultByUrl = new Map<string, XMediaCandidate>();

  const timedOut = (): boolean => performance.now() >= deadline || visitedNodes >= maxNodes;

  const dataValue = (value: object, key: string): unknown => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
        ? descriptor.value
        : undefined;
    } catch {
      return undefined;
    }
  };

  const httpUrl = (value: unknown): string | undefined => {
    if (typeof value !== "string" || value.length === 0) return undefined;
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
      return url.href;
    } catch {
      return undefined;
    }
  };

  const previewUrl = (value: unknown): string | undefined => {
    const url = httpUrl(value);
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      const format = parsed.searchParams.get("format")?.toLowerCase();
      if (/\.(?:jpe?g|png|webp|avif|gif)$/i.test(parsed.pathname)
        || ["jpg", "jpeg", "png", "webp", "avif", "gif"].includes(format ?? "")) return url;
    } catch {
      return undefined;
    }
    return undefined;
  };

  const addVideoVariants = (variants: unknown, mediaObject: object): boolean => {
    if (!Array.isArray(variants)) return false;
    let best: {url: string; bitrate: number} | undefined;
    const variantCount = dataValue(variants, "length");
    if (typeof variantCount !== "number") return false;
    for (let index = 0; index < variantCount; index += 1) {
      if (timedOut()) return false;
      const variant = dataValue(variants, String(index));
      if (typeof variant !== "object" || variant === null) continue;
      const rawUrl = dataValue(variant, "url");
      const url = httpUrl(rawUrl);
      if (!url) continue;
      const rawContentType = dataValue(variant, "content_type") ?? dataValue(variant, "mime_type");
      const contentType = typeof rawContentType === "string" ? rawContentType.toLowerCase() : "";
      let isMp4 = /^video\/mp4(?:\s*;|$)/i.test(contentType);
      try {
        isMp4 ||= /\.mp4$/i.test(new URL(url).pathname);
      } catch {
        continue;
      }
      if (!isMp4) continue;
      const rawBitrate = dataValue(variant, "bitrate");
      const bitrate = typeof rawBitrate === "number" && Number.isFinite(rawBitrate) ? rawBitrate : 0;
      if (!best || bitrate > best.bitrate) best = {url, bitrate};
    }
    if (!best) return false;

    const candidate: XMediaCandidate = {url: best.url, kind: "video"};
    for (const key of ["media_url_https", "media_url", "thumbnail_url", "preview_image_url", "poster"]) {
      const preview = previewUrl(dataValue(mediaObject, key));
      if (preview) {
        candidate.previewUrl = preview;
        break;
      }
    }
    const existing = resultByUrl.get(candidate.url);
    if (!existing || (!existing.previewUrl && candidate.previewUrl)) resultByUrl.set(candidate.url, candidate);
    return true;
  };

  const isMp4Url = (url: string, rawContentType: unknown): boolean => {
    const contentType = typeof rawContentType === "string" ? rawContentType.toLowerCase() : "";
    if (/^video\/mp4(?:\s*;|$)/i.test(contentType)) return true;
    try {
      return /\.mp4$/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  };

  const addVideoSource = (source: object, mediaObject: object): boolean => {
    const url = httpUrl(dataValue(source, "src"));
    if (!url || !isMp4Url(url,
      dataValue(source, "content_type") ?? dataValue(source, "mime_type") ?? dataValue(source, "type"))) return false;
    const candidate: XMediaCandidate = {url, kind: "video"};
    for (const key of ["media_url_https", "media_url", "thumbnail_url", "preview_image_url", "poster"]) {
      const preview = previewUrl(dataValue(mediaObject, key));
      if (preview) {
        candidate.previewUrl = preview;
        break;
      }
    }
    const existing = resultByUrl.get(candidate.url);
    if (!existing || (!existing.previewUrl && candidate.previewUrl)) resultByUrl.set(candidate.url, candidate);
    return true;
  };

  const addDirectVideoSource = (rawUrl: unknown, owner: object): boolean => {
    const url = httpUrl(rawUrl);
    if (!url || !isMp4Url(url,
      dataValue(owner, "content_type") ?? dataValue(owner, "mime_type") ?? dataValue(owner, "type"))) return false;
    const candidate: XMediaCandidate = {url, kind: "video"};
    const preview = previewUrl(dataValue(owner, "poster"));
    if (preview) candidate.previewUrl = preview;
    if (!resultByUrl.has(candidate.url)) resultByUrl.set(candidate.url, candidate);
    return true;
  };

  const addVideoInfo = (videoInfo: object, mediaObject: object): boolean =>
    addVideoVariants(dataValue(videoInfo, "variants"), mediaObject);

  const addAttachedMedia = (mediaObject: object, includeDirectVariants: boolean): boolean => {
    let foundVideo = false;
    const videoInfo = dataValue(mediaObject, "video_info") ?? dataValue(mediaObject, "videoInfo");
    if (typeof videoInfo === "object" && videoInfo !== null && addVideoInfo(videoInfo, mediaObject)) {
      foundVideo = true;
    }
    if (includeDirectVariants && addVideoVariants(dataValue(mediaObject, "variants"), mediaObject)) {
      foundVideo = true;
    }
    if (includeDirectVariants && !foundVideo) {
      const source = dataValue(mediaObject, "source");
      if (typeof source === "object" && source !== null && addVideoSource(source, mediaObject)) foundVideo = true;
    }
    return foundVideo;
  };

  // Only follow fields that belong to a tweet and its media. In particular,
  // do not recursively inspect arbitrary React props such as app stores,
  // caches, clients, event handlers, or unrelated page state.
  const tweetPropKeys = [
    "tweet", "tweetResult", "tweet_results", "tweetResults", "tweet_result",
    "post", "media", "mediaDetails", "media_details", "legacy", "extended_entities",
    "extendedEntities", "video_info", "videoInfo",
  ];
  const tweetDataKeys = [
    "tweet", "tweetResult", "tweet_results", "tweetResults", "tweet_result",
    "retweeted_status", "retweetedStatus", "quoted_status", "quotedStatus", "post", "result",
    "legacy", "extended_entities", "extendedEntities", "mediaDetails", "media_details",
    "entities", "media", "video_info", "videoInfo",
  ];

  const inspectPostTree = (roots: Array<{value: unknown; mediaObject: boolean}>, requireIdentity = false): boolean => {
    const pending: Array<{value: unknown; depth: number; mediaObject: boolean; targetMatched: boolean}> = [];
    for (let index = roots.length - 1; index >= 0; index -= 1) {
      pending.push({...roots[index]!, depth: 0, targetMatched: !targetPostId || !requireIdentity});
    }
    const seenInTree = new WeakSet<object>();
    let foundVideo = false;
    while (pending.length > 0 && !timedOut()) {
      const entry = pending.pop();
      if (!entry || typeof entry.value !== "object" || entry.value === null) continue;
      const value = entry.value;
      if (seenInTree.has(value)) continue;
      seenInTree.add(value);
      visitedNodes += 1;

      if (Array.isArray(value)) {
        if (entry.depth >= maxDepth) continue;
        const length = dataValue(value, "length");
        if (typeof length === "number") {
          for (let index = length - 1; index >= 0; index -= 1) {
            if (timedOut()) break;
            const child = dataValue(value, String(index));
            if (typeof child === "object" && child !== null) {
              pending.push({...entry, value: child, depth: entry.depth + 1});
            }
          }
        }
        continue;
      }

      const postId = dataValue(value, "rest_id") ?? dataValue(value, "id_str");
      if (targetPostId && typeof postId === "string" && /^\d+$/.test(postId)
        && postId !== targetPostId && (dataValue(value, "rest_id") || dataValue(value, "legacy") || dataValue(value, "extended_entities") || dataValue(value, "full_text"))) continue;
      const targetMatched = entry.targetMatched || postId === targetPostId;

      if (targetMatched && addAttachedMedia(value, entry.mediaObject)) foundVideo = true;
      if (entry.depth >= maxDepth) continue;

      for (const key of tweetDataKeys) {
        if (timedOut()) break;
        if (targetPostId && ["quoted_status", "quotedStatus", "retweeted_status", "retweetedStatus"].includes(key)) continue;
        const child = dataValue(value, key);
        if (typeof child === "object" && child !== null) {
          const mediaObject = entry.mediaObject
            || key === "media"
            || key === "mediaDetails"
            || key === "media_details";
          pending.push({value: child, depth: entry.depth + 1, mediaObject, targetMatched});
        }
      }
    }
    return foundVideo;
  };

  const inspectTweetProps = (props: object, requireIdentity = false): boolean => {
    if (!requireIdentity && addAttachedMedia(props, false)) return true;
    const roots: Array<{value: unknown; mediaObject: boolean}> = [];
    for (const key of tweetPropKeys) {
      if (timedOut()) break;
      const value = dataValue(props, key);
      if (typeof value === "object" && value !== null) {
        roots.push({
          value,
          mediaObject: key === "media" || key === "mediaDetails" || key === "media_details",
        });
      }
    }
    return inspectPostTree(roots, requireIdentity);
  };

  const inspectPlayerProps = (props: object, requireIdentity = false): boolean => {
    if (requireIdentity) return inspectTweetProps(props, true);
    let foundVideo = addAttachedMedia(props, true);
    if (addDirectVideoSource(dataValue(props, "src"), props)) foundVideo = true;
    if (!foundVideo && inspectTweetProps(props)) foundVideo = true;
    return foundVideo;
  };

  // On X's expanded-video route, the target player may exist without an
  // article. Inspect the dialog/player elements first so their media stays
  // ahead of background posts in the returned candidates.
  const mediaSelectors = [
    "dialog video",
    '[role="dialog"] video',
    '[data-testid="videoPlayer"]',
    "video[data-testid]",
  ];
  if (/\/status\/[^/]+\/video\/\d+\/?$/i.test(location.pathname)) mediaSelectors.push("video");
  const seenMediaElements = new WeakSet<object>();
  let inspectedMediaElements = 0;
  for (const selector of mediaSelectors) {
    if (timedOut() || inspectedMediaElements >= maxMediaElements) break;
    const mediaElements = document.querySelectorAll(selector);
    for (let mediaIndex = 0; mediaIndex < mediaElements.length && inspectedMediaElements < maxMediaElements && !timedOut(); mediaIndex += 1) {
      const mediaElement = mediaElements[mediaIndex];
      if (!mediaElement || seenMediaElements.has(mediaElement) || !inTargetPost(mediaElement)) continue;
      seenMediaElements.add(mediaElement);
      inspectedMediaElements += 1;
      let ownKeys: string[];
      try {
        ownKeys = Object.getOwnPropertyNames(mediaElement);
      } catch {
        continue;
      }
      for (const key of ownKeys) {
        if (timedOut()) break;
        const directProps = key.startsWith("__reactProps$") ? dataValue(mediaElement, key) : undefined;
        if (typeof directProps === "object" && directProps !== null) inspectPlayerProps(directProps);
      }
      for (const key of ownKeys) {
        if (timedOut()) break;
        if (!key.startsWith("__reactFiber$") && !key.startsWith("__reactInternalInstance$")) continue;
        let fiber = dataValue(mediaElement, key);
        for (let ancestor = 0; typeof fiber === "object" && fiber !== null && ancestor < 40 && !timedOut(); ancestor += 1) {
          const memoizedProps = dataValue(fiber, "memoizedProps");
          let foundInProps = typeof memoizedProps === "object" && memoizedProps !== null
            ? inspectPlayerProps(memoizedProps, Boolean(targetPostId && ancestor > 0))
            : false;
          const pendingProps = dataValue(fiber, "pendingProps");
          if (!foundInProps && typeof pendingProps === "object" && pendingProps !== null && pendingProps !== memoizedProps) {
            foundInProps = inspectPlayerProps(pendingProps, Boolean(targetPostId && ancestor > 0));
          }
          if (foundInProps) break;
          fiber = dataValue(fiber, "return");
        }
      }
    }
  }

  const articles = document.querySelectorAll("article");
  const articleCount = Math.min(articles.length, maxArticles);
  for (let articleIndex = 0; articleIndex < articleCount && !timedOut(); articleIndex += 1) {
    const article = articles[articleIndex];
    if (!article || !inTargetPost(article)) continue;

    let ownKeys: string[];
    try {
      ownKeys = Object.getOwnPropertyNames(article);
    } catch {
      continue;
    }
    let articleHasPostVideo = false;
    for (const key of ownKeys) {
      if (timedOut()) break;
      const directProps = key.startsWith("__reactProps$") ? dataValue(article, key) : undefined;
      if (typeof directProps === "object" && directProps !== null) {
        articleHasPostVideo = inspectTweetProps(directProps);
        if (articleHasPostVideo) break;
      }
    }
    if (articleHasPostVideo) continue;
    for (const key of ownKeys) {
      if (timedOut()) break;
      if (!key.startsWith("__reactFiber$") && !key.startsWith("__reactInternalInstance$")) continue;
      let fiber = dataValue(article, key);
      for (let ancestor = 0; typeof fiber === "object" && fiber !== null && ancestor < 40 && !timedOut(); ancestor += 1) {
        const memoizedProps = dataValue(fiber, "memoizedProps");
        let foundInProps = typeof memoizedProps === "object" && memoizedProps !== null
          ? inspectTweetProps(memoizedProps, Boolean(targetPostId && ancestor > 0))
          : false;
        const pendingProps = dataValue(fiber, "pendingProps");
        if (!foundInProps && typeof pendingProps === "object" && pendingProps !== null && pendingProps !== memoizedProps) {
          foundInProps = inspectTweetProps(pendingProps, Boolean(targetPostId && ancestor > 0));
        }
        if (foundInProps) break;
        fiber = dataValue(fiber, "return");
      }
    }
  }

  return [...resultByUrl.values()];
}
