import type {XMediaSnapshot, XPostSnapshot} from "../../core/x-media.js";

/** Injected into MAIN. All executable helpers must stay inside this function. */
export function scanXMedia(targetPostId?: string | null, onlyPostKeys?: string[]): XMediaSnapshot {
  const url = location.href;
  const snapshot: XMediaSnapshot = {url, posts: [], limited: false};
  if (!/^(?:www\.)?(?:x\.com|twitter\.com)$/i.test(location.hostname)) return snapshot;
  const deadline = performance.now() + 2_500;
  let nodes = 0, textSize = 0;
  const exhausted = (): boolean => {
    if (performance.now() < deadline && nodes < 18_000 && textSize < 1_000_000) return false;
    snapshot.limited = true;
    return true;
  };
  const value = (object: object, key: string): unknown => {
    try { const d = Object.getOwnPropertyDescriptor(object, key); return d && "value" in d ? d.value : undefined; }
    catch { return undefined; }
  };
  // Copy only the schema needed by the pure parser. Never serialize React
  // itself, author information, post text, caches, stores or callback props.
  const fields = ["__typename", "rest_id", "id_str", "media_key", "type", "media_url_https", "media_url",
    "thumbnail_url", "preview_image_url", "poster", "src", "url", "content_type", "mime_type", "bitrate", "bit_rate",
    "tweet", "tweetResult", "tweet_results", "tweetResults", "tweet_result", "post", "result", "legacy",
    "extended_entities", "extendedEntities", "entities", "media", "mediaDetails", "media_details",
    "quoted_status_result", "quotedRefResult", "retweeted_status_result", "quoted_status", "quotedStatus", "retweeted_status", "retweetedStatus",
    "video_info", "videoInfo", "variants", "source"];
  const copying = new WeakSet<object>();
  const copied = new WeakMap<object, unknown>();
  const project = (input: unknown, depth = 0): unknown => {
    if (exhausted()) return undefined;
    nodes++;
    if (typeof input === "string") {
      if (input.length > 8_192) { snapshot.limited = true; return undefined; }
      textSize += input.length;
      return input;
    }
    if (typeof input === "number" || typeof input === "boolean") return input;
    if (!input || typeof input !== "object" || copying.has(input)) return undefined;
    if (depth > 36) { snapshot.limited = true; return undefined; }
    if (copied.has(input)) return copied.get(input);
    copying.add(input);
    let output: unknown;
    if (Array.isArray(input)) {
      const result: unknown[] = [];
      const size = value(input, "length");
      const length = typeof size === "number" ? Math.min(size, 256) : 0;
      if (typeof size === "number" && size > length) snapshot.limited = true;
      for (let i = 0; i < length && !exhausted(); i++) {
        const child = project(value(input, String(i)), depth + 1);
        if (child !== undefined) result.push(child);
      }
      output = result;
    } else {
      const result: {[key: string]: unknown} = {};
      for (const key of fields) {
        if (exhausted()) break;
        const raw = value(input, key);
        if (raw === undefined) continue;
        const child = project(raw, depth + 1);
        if (child !== undefined) result[key] = child;
      }
      output = result;
    }
    copying.delete(input);
    copied.set(input, output);
    return output;
  };
  const quote = '[data-testid="quoteTweet"], [data-testid="quotedTweet"], [role="link"]:not(a):has(a[href*="/status/"])';
  const postId = (root: Element): string | undefined => {
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].filter(link =>
      !link.parentElement?.closest(quote) && (root.tagName.toLowerCase() === "article"
        ? link.closest("article") === root : !link.closest("article")));
    const link = links.find(a => a.querySelector("time")) ?? (root.tagName.toLowerCase() === "article" ? undefined : links[0]);
    if (!link) return undefined;
    try {
      const parsed = new URL(link.href, url);
      return /^(?:www\.)?(?:x\.com|twitter\.com)$/i.test(parsed.hostname) ? /\/status\/(\d+)(?:\/|$)/.exec(parsed.pathname)?.[1] : undefined;
    } catch { return undefined; }
  };
  const roots = [...document.querySelectorAll('article, dialog, [role="dialog"]')];
  for (const player of document.querySelectorAll('[data-testid="videoPlayer"], video')) {
    if (!player.closest('article, dialog, [role="dialog"]') && !roots.includes(player)) roots.push(player);
  }
  roots.sort((a, b) => Number(a.tagName.toLowerCase() === "article") - Number(b.tagName.toLowerCase() === "article"));
  const supplementalReads: Array<() => void> = [];
  let count = 0;
  for (const root of roots) {
    if (exhausted()) break;
    if (root.closest('aside, [data-testid="sidebarColumn"]') || root.parentElement?.closest('article, dialog, [role="dialog"]')) continue;
    const id = postId(root);
    if (targetPostId && id !== targetPostId) continue;
    const key = id ? `post:${id}` : `element:${count}`;
    count++;
    if (onlyPostKeys && (!id || !onlyPostKeys.includes(key))) continue;
    const post: XPostSnapshot = {key, ...(id ? {postId: id} : {}), observed: [], roots: []};
    const inScope = (element: Element): boolean => !targetPostId || !element.closest(quote);
    const elements = [root, ...root.querySelectorAll('[data-testid="videoPlayer"], video, [data-testid="tweetPhoto"]')].filter(inScope);
    if (elements.length > 80) snapshot.limited = true;
    const seenProps = new WeakSet<object>();
    const ownsPost = (data: unknown, depth = 0): boolean => {
      if (!id || !data || typeof data !== "object" || depth > 12) return false;
      const item = data as {[key: string]: unknown};
      if (item["rest_id"] === id || item["id_str"] === id) return true;
      return ["tweet", "tweetResult", "tweet_results", "tweet_result", "post", "result", "legacy"]
        .some(key => ownsPost(item[key], depth + 1));
    };
    const readProps = (element: Element, player: boolean): void => {
      const ownKeys = Object.getOwnPropertyNames(element);
      const add = (props: unknown, ancestor: boolean): boolean => {
        if (!props || typeof props !== "object" || exhausted()) return false;
        if (seenProps.has(props)) return ownsPost(copied.get(props));
        seenProps.add(props);
        const data = project(props);
        if (data && typeof data === "object" && Object.keys(data).length) {
          post.roots.push({value: data, player, requireIdentity: Boolean(id && ancestor)});
        }
        return ownsPost(data);
      };
      for (const name of ownKeys) if (name.startsWith("__reactProps$")) add(value(element, name), false);
      for (const name of ownKeys) {
        if (!name.startsWith("__reactFiber$") && !name.startsWith("__reactInternalInstance$")) continue;
        let fiber = value(element, name);
        const seen = new WeakSet<object>();
        for (let depth = 0; fiber && typeof fiber === "object" && !seen.has(fiber) && !exhausted(); depth++) {
          if (depth >= 40) break;
          seen.add(fiber);
          const props = value(fiber, "memoizedProps");
          const owned = add(props, depth > 0);
          // pendingProps may represent an uncommitted React render: prefer the
          // committed props, using pending only when committed props are absent.
          if (!props && add(value(fiber, "pendingProps"), depth > 0)) break;
          if (owned) break;
          fiber = value(fiber, "return");
        }
      }
    };
    // Read DOM media for every post before optional React supplementation.
    supplementalReads.push(() => {
      for (const element of elements.slice(0, 80)) {
        if (exhausted()) break;
        readProps(element, element.matches('video, [data-testid="videoPlayer"]'));
      }
    });
    for (const image of root.querySelectorAll<HTMLImageElement>("img")) {
      if (exhausted()) break;
      nodes++;
      if (!inScope(image)) continue;
      const src = image.currentSrc || image.src;
      try {
        const parsed = new URL(src, url);
        if (!/^https?:$/.test(parsed.protocol)) continue;
        if (!image.closest('[data-testid="tweetPhoto"]')
          && !(parsed.hostname === "pbs.twimg.com" && /^\/(?:media|amplify_video_thumb|tweet_video_thumb|ext_tw_video_thumb)\//.test(parsed.pathname))) continue;
        if (/\/profile_(?:images|banners)\//.test(parsed.pathname)) continue;
        post.observed.push({kind: "image", url: parsed.href});
      } catch { /* Ignore malformed image references. */ }
    }
    for (const video of [...(root.tagName.toLowerCase() === "video" ? [root as HTMLVideoElement] : []), ...root.querySelectorAll<HTMLVideoElement>("video")]) {
      if (exhausted()) break;
      nodes++;
      if (!inScope(video)) continue;
      const sources = [video.currentSrc, video.src, video.querySelector("source")?.src];
      const src = sources.find(source => source && /^https?:/i.test(source)) ?? sources.find(Boolean);
      post.observed.push({kind: "video", ...(src ? {url: src} : {}), ...(video.poster ? {previewUrl: video.poster} : {})});
    }
    snapshot.posts.push(post);
  }
  for (const read of supplementalReads) {
    if (exhausted()) break;
    read();
  }
  // Read the store through the mounted list's React ancestors. The entity table
  // alone is never a collection: it also contains posts from other pages.
  const object = (input: unknown): object | undefined => input !== null && typeof input === "object" ? input : undefined;
  const get = (input: unknown, key: string): unknown => { const obj = object(input); return obj ? value(obj, key) : undefined; };
  const mountedIds = new Set(snapshot.posts.flatMap(post => post.postId ? [post.postId] : []));
  const stores = new Set<object>();
  const lists: string[][] = [];
  const timelineModules = new Set<object>();
  const seenFibers = new WeakSet<object>();
  const entryIds = (input: unknown, depth = 0): string[] => {
    if (depth > 12 || !input) return [];
    if (performance.now() >= deadline) { snapshot.limited = true; return []; }
    if (Array.isArray(input)) return input.flatMap(item => entryIds(item, depth + 1));
    const entry = get(input, "entryId") ?? get(input, "entry_id");
    if (typeof entry === "string" && /^(?:tweet|sq-I-t)-\d+$/.test(entry)) return [entry.replace(/^(?:tweet|sq-I-t)-/, "")];
    const tweetId = get(input, "tweetId") ?? get(input, "tweet_id");
    if (typeof tweetId === "string" && /^\d+$/.test(tweetId)) return [tweetId];
    const type = get(input, "type") ?? get(input, "entryType");
    const id = get(get(input, "content"), "id") ?? get(input, "id");
    if (type === "tweet" && typeof id === "string" && /^\d+$/.test(id)) return [id];
    return ["item", "itemContent", "content", "items", "entries", "entry", "tweet_results", "result"]
      .flatMap(key => entryIds(get(input, key), depth + 1));
  };
  const listRoots = new Set([...roots, ...document.querySelectorAll('[data-testid="primaryColumn"]')]);
  for (const root of listRoots) {
    if (root.closest('aside, [data-testid="sidebarColumn"]')) continue;
    for (const name of Object.getOwnPropertyNames(root)) {
      if (!name.startsWith("__reactFiber$") && !name.startsWith("__reactInternalInstance$")) continue;
      let fiber = object(value(root, name));
      for (let depth = 0; fiber && depth < 200 && !seenFibers.has(fiber); depth++) {
        if (performance.now() >= deadline) { snapshot.limited = true; break; }
        seenFibers.add(fiber);
        const props = value(fiber, "memoizedProps");
        const store = object(get(props, "store"));
        if (store && typeof value(store, "getState") === "function") stores.add(store);
        for (const key of ["module", "urtModule"]) {
          const module = object(get(props, key));
          if (module && typeof value(module, "timelineId") === "string") timelineModules.add(module);
        }
        for (const key of ["entries", "items"]) {
          const items = get(props, key);
          if (Array.isArray(items)) {
            const ids = [...new Set(entryIds(items))];
            if (ids.length && [...mountedIds].every(id => ids.includes(id))) lists.push(ids);
          }
        }
        fiber = object(value(fiber, "return"));
      }
    }
  }
  // Identify the active history list even if its store has no usable posts or
  // continuation action. Losing fetchBottom does not mean switching to Likes.
  if (!targetPostId && !onlyPostKeys && /^\/i\/(?:history|bookmarks)\/?$/.test(location.pathname)
    && timelineModules.size === 1) {
    const module = [...timelineModules][0]!;
    snapshot.bookmarkList = value(module, "timelineId") === "bookmarks" && !value(module, "scopeId")
      ? "bookmarks" : "other";
  }
  let storedTimelineRecovered = false;
  let bookmarkIdentity: object | undefined;
  for (const store of stores) {
    try {
      const state = (value(store, "getState") as () => unknown).call(store);
      const table = get(get(get(state, "entities"), "tweets"), "entities");
      if (!object(table)) continue;
      const candidates = [...lists];
      const moduleCandidates: string[][] = [];
      for (const module of timelineModules) {
        // X's active URT module identifies the list and exposes read-only selectors
        // which apply its injections, dismissals and pinned entry ordering.
        const selectEntries = value(module, "selectEntries");
        const selectPinned = value(module, "selectPinnedEntry");
        let entries: unknown;
        let pinned: unknown;
        try {
          if (typeof selectEntries === "function") {
            entries = selectEntries.call(module, state);
            if (typeof selectPinned === "function") pinned = selectPinned.call(module, state);
          } else {
            const timelineId = String(value(module, "timelineId"));
            const scope = value(module, "scopeId");
            const timeline = get(get(state, "urt"), timelineId + (typeof scope === "string" ? scope : ""));
            entries = get(timeline, "entries");
            pinned = get(timeline, "pinnedEntry");
          }
        } catch { continue; }
        const ids = [...new Set([...entryIds(pinned), ...entryIds(entries)])];
        if (ids.length && [...mountedIds].every(id => ids.includes(id))) moduleCandidates.push(ids);
      }
      // Ambiguous lists fail closed. Never fall back to enumerating all entities.
      const distinct = new Map((moduleCandidates.length ? moduleCandidates : candidates).map(ids => [JSON.stringify(ids), ids]));
      const ids = targetPostId ? [targetPostId] : mountedIds.size && distinct.size === 1 ? [...distinct.values()][0] : undefined;
      if (!ids) continue;
      if (!targetPostId && !onlyPostKeys && moduleCandidates.length === 1 && timelineModules.size === 1 && stores.size === 1) {
        const module = [...timelineModules][0]!;
        snapshot.bookmarkContinuation = value(module, "timelineId") === "bookmarks" && !value(module, "scopeId")
          && typeof value(module, "fetchBottom") === "function" && typeof value(store, "dispatch") === "function";
      }
      if (!targetPostId && moduleCandidates.length === 1 && timelineModules.size === 1) {
        const module = [...timelineModules][0]!;
        if (value(module, "timelineId") === "bookmarks" && !value(module, "scopeId")) bookmarkIdentity = module;
      }
      const recovered: XPostSnapshot[] = [];
      let complete = true;
      for (const id of ids) {
        if (onlyPostKeys && !onlyPostKeys.includes(`post:${id}`)) continue;
        const tweet = get(table, id);
        if (!object(tweet)) { complete = false; continue; }
        if (performance.now() >= deadline) { complete = false; snapshot.limited = true; break; }
        // Projection is budgeted per post, not by the total number of loaded posts.
        nodes = 0; textSize = 0;
        const relatedSeen = new Set<string>();
        const withRelated = (record: unknown, owner: string, depth = 0): unknown => {
          if (depth > 4 || relatedSeen.has(owner)) return undefined;
          relatedSeen.add(owner);
          const data = project(record);
          if (!data || typeof data !== "object") return data;
          const raw = get(record, "legacy") ?? record;
          for (const kind of ["quoted", "retweeted"]) {
            const relatedId = get(raw, `${kind}_status_id_str`);
            if (typeof relatedId !== "string" || !/^\d+$/.test(relatedId)) continue;
            const related = get(table, relatedId);
            if (object(related)) (data as {[key: string]: unknown})[`${kind}_status`] = withRelated(related, relatedId, depth + 1);
          }
          return data;
        };
        const data = withRelated(tweet, id);
        recovered.push({key: `post:${id}`, postId: id, observed: [],
          roots: [{value: {rest_id: id, tweet: data}, requireIdentity: true, player: false}]});
      }
      const mounted = new Map(snapshot.posts.map(post => [post.key, post]));
      snapshot.posts = [...recovered.map(post => {
        const existing = mounted.get(post.key);
        mounted.delete(post.key);
        return existing ? {...post, observed: existing.observed, roots: [...post.roots, ...existing.roots]} : post;
      }), ...mounted.values()];
      if (!targetPostId && complete) storedTimelineRecovered = true;
    } catch { /* Store/schema changes must not discard DOM or received media. */ }
  }

  let captureEpoch: number | undefined;
  // Received bookmark pages survive X removing offscreen article elements.
  if (!targetPostId && snapshot.bookmarkList !== "other" && /^\/i\/(?:history|bookmarks)\/?$/.test(location.pathname) && typeof window !== "undefined") {
    snapshot.bookmarkCaptureMissing = !storedTimelineRecovered;
    try {
      const read = value(window, "__harvestBookmarkMediaV1");
      if (typeof read === "function") {
        const captured = read() as {posts?: XPostSnapshot[]; limited?: boolean; received?: boolean; epoch?: number};
        captureEpoch = Number.isSafeInteger(captured.epoch) ? captured.epoch : undefined;
        const sameCollection = !storedTimelineRecovered || (bookmarkIdentity && captureEpoch !== undefined);
        snapshot.bookmarkCaptureMissing = !storedTimelineRecovered && captured.received !== true;
        if (sameCollection && Array.isArray(captured.posts)) {
          const mounted = new Map(snapshot.posts.map(post => [post.key, post]));
          const combined: XPostSnapshot[] = [];
          for (const post of captured.posts) {
            if (onlyPostKeys && !onlyPostKeys.includes(post.key)) continue;
            const existing = mounted.get(post.key);
            combined.push(existing ? {...post, observed: existing.observed, roots: [...post.roots, ...existing.roots]} : post);
            mounted.delete(post.key);
          }
          snapshot.posts = [...combined, ...mounted.values()];
        }
        snapshot.limited ||= captured.limited === true;
      }
    } catch { snapshot.limited = true; }
  }
  // Keep evidence across separate Analyze operations, not just fetches in one scan.
  // This lives in the X document, never in persistent extension storage.
  if (typeof window !== "undefined") {
    type Memory = {url: string; identity: object; epoch?: number; posts: XPostSnapshot[]};
    const key = "__harvestBookmarkScanMemoryV1";
    const previous = value(window, key) as Memory | undefined;
    if (bookmarkIdentity && !onlyPostKeys && /^\/i\/(?:history|bookmarks)\/?$/.test(location.pathname)) {
      const same = previous?.url === url && previous.identity === bookmarkIdentity && previous.epoch === captureEpoch;
      const combined = new Map<string, XPostSnapshot>((same ? previous.posts : []).map(post => [post.key, post]));
      for (const post of snapshot.posts) {
        const old = combined.get(post.key);
        combined.set(post.key, old ? {...post,
          observed: [...new Map([...old.observed, ...post.observed].map(item => [JSON.stringify(item), item])).values()],
          roots: [...new Map([...old.roots, ...post.roots].map(item => [JSON.stringify(item), item])).values()],
        } : post);
      }
      snapshot.posts = [...combined.values()];
      Object.defineProperty(window, key, {configurable: true, value: {url, identity: bookmarkIdentity, epoch: captureEpoch, posts: snapshot.posts}});
    } else if (!onlyPostKeys && previous) {
      delete (window as unknown as Record<string, unknown>)[key];
    }
  }
  if (location.href.split("#")[0] !== url.split("#")[0]) throw new Error("解析中にページが移動しました。もう一度解析してください。");
  return snapshot;
}
