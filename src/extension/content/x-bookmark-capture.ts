import type {XPostSnapshot} from "../../core/x-media.js";

/** Runs at document_start in MAIN; retains only media evidence in this document. */
export function installXBookmarkCapture(): void {
  const bridge = "__harvestBookmarkMediaV1";
  if (Object.getOwnPropertyDescriptor(window, bridge)) return;
  const posts = new Map<string, XPostSnapshot>();
  let generation = 0, failed = false, received = false;
  let pageUrl = location.href.split("#")[0];
  const bookmarkPage = (): boolean => /^\/i\/(?:history|bookmarks)\/?$/.test(location.pathname);
  const reset = (): void => { posts.clear(); generation++; failed = false; received = false; };
  const syncPage = (): void => {
    const current = location.href.split("#")[0];
    if (pageUrl !== current) { reset(); pageUrl = current; }
  };
  const record = (input: unknown): {[key: string]: unknown} | undefined =>
    input !== null && typeof input === "object" && !Array.isArray(input) ? input as {[key: string]: unknown} : undefined;
  const fields = ["__typename", "rest_id", "id_str", "media_key", "type", "media_url_https", "media_url",
    "thumbnail_url", "preview_image_url", "content_type", "bitrate", "url", "tweet", "result", "legacy",
    "extended_entities", "entities", "media", "mediaDetails", "video_info", "variants",
    "quoted_status_result", "retweeted_status_result", "quoted_status", "retweeted_status"];
  const project = (input: unknown, depth = 0): unknown => {
    if (depth > 24) { failed = true; return undefined; }
    if (typeof input === "string") return input.length <= 8192 ? input : undefined;
    if (typeof input === "number" || typeof input === "boolean") return input;
    if (Array.isArray(input)) return input.map(item => project(item, depth + 1));
    const obj = record(input);
    if (!obj) return undefined;
    const output: {[key: string]: unknown} = {};
    for (const key of fields) {
      const raw = Object.getOwnPropertyDescriptor(obj, key);
      if (raw && "value" in raw) output[key] = project(raw.value, depth + 1);
    }
    return output;
  };
  const ingest = (input: unknown, token: number): void => {
    syncPage();
    if (token !== generation || !bookmarkPage()) return;
    const data = record(record(input)?.["data"]);
    const timeline = record(record(data?.["bookmark_timeline_v2"])?.["timeline"]);
    const instructions = timeline?.["instructions"];
    if (!Array.isArray(instructions)) { failed = true; return; }
    received = true;
    const addItem = (input: unknown): void => {
      const item = record(input);
      const result = record(record(item?.["tweet_results"])?.["result"]);
      const tweet = record(result?.["tweet"]) ?? result;
      const legacy = record(tweet?.["legacy"]);
      const id = tweet?.["rest_id"] ?? legacy?.["id_str"];
      if (typeof id !== "string" || !/^\d+$/.test(id)) return;
      posts.set(id, {key: `post:${id}`, postId: id, observed: [],
        roots: [{value: project(result), requireIdentity: true, player: false}]});
    };
    for (const instruction of instructions) {
      const row = record(instruction);
      if (row?.["type"] === "TimelineClearCache") posts.clear();
      const entries = Array.isArray(row?.["entries"]) ? row["entries"] : row?.["entry"] ? [row["entry"]] : [];
      for (const entry of entries) {
        const content = record(record(entry)?.["content"]);
        addItem(content?.["itemContent"]);
        if (Array.isArray(content?.["items"])) for (const child of content["items"]) {
          addItem(record(record(child)?.["item"])?.["itemContent"]);
        }
      }
    }
  };
  // Request metadata is used transiently for scope/cursor detection, never retained.
  const begin = (rawUrl: string, body?: unknown): number | undefined => {
    syncPage();
    if (!bookmarkPage()) return undefined;
    try {
      const url = new URL(rawUrl, location.href);
      if (url.origin !== location.origin) return undefined;
      const operation = /^\/i\/api\/graphql\/[^/]+\/([^/]+)$/.exec(url.pathname)?.[1];
      // /i/history shares its URL with Likes. Never mix that tab with bookmarks.
      if (operation === "Likes") { reset(); return undefined; }
      if (operation !== "Bookmarks") return undefined;
      const request = typeof body === "string" ? record(JSON.parse(body)) : undefined;
      const variables = record(request?.["variables"] ?? JSON.parse(url.searchParams.get("variables") ?? "{}"));
      if (!variables?.["cursor"]) reset();
      return generation;
    } catch { return undefined; }
  };
  Object.defineProperty(window, bridge, {value: () => {
    syncPage();
    return bookmarkPage() ? {posts: [...posts.values()], limited: failed, received} : {posts: [], limited: false, received: false};
  }});
  // Observe only responses to requests made by X. No replay or additional request.
  const originalFetch = window.fetch;
  window.fetch = function(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    let token: number | undefined;
    try {
      const input = args[0];
      token = begin(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, args[1]?.body);
    } catch { /* Leave X's request untouched. */ }
    const promise = Reflect.apply(originalFetch, this, args) as ReturnType<typeof fetch>;
    if (token !== undefined) void promise.then(response => {
      if (!response.ok) { if (token === generation) failed = true; return; }
      return response.clone().json().then(data => ingest(data, token!));
    }).catch(() => { if (token === generation) failed = true; });
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const urls = new WeakMap<XMLHttpRequest, string>();
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: unknown[]): void {
    Reflect.apply(originalOpen, this, [method, url, ...rest]);
    urls.set(this, String(url));
  };
  XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null): void {
    const token = begin(urls.get(this) ?? "", body);
    const onLoad = (): void => {
      if (token === undefined) return;
      if (this.status < 200 || this.status >= 300) { if (token === generation) failed = true; return; }
      try { ingest(this.responseType === "json" ? this.response : JSON.parse(this.responseText), token); }
      catch { if (token === generation) failed = true; }
    };
    if (token !== undefined) {
      this.addEventListener("load", onLoad, {once: true});
      this.addEventListener("loadend", () => this.removeEventListener("load", onLoad), {once: true});
    }
    Reflect.apply(originalSend, this, [body]);
  };
  for (const name of ["pushState", "replaceState"] as const) {
    const original = history[name];
    history[name] = function(...args: Parameters<History[typeof name]>): void {
      Reflect.apply(original, this, args);
      syncPage();
    };
  }
  addEventListener("popstate", syncPage);
  addEventListener("pagehide", reset);
}
