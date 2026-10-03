import type {BookmarkPageResult} from "../contracts/page-contracts.js";

export type {BookmarkPageResult} from "../contracts/page-contracts.js";

/** Runs in MAIN. Only invokes the active bookmark module's existing continuation action. */
export async function fetchXBookmarkPage(expectedUrl: string): Promise<BookmarkPageResult> {
  const own = (input: unknown, key: string): any => {
    if (!input || (typeof input !== "object" && typeof input !== "function")) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  const samePage = (): boolean => location.href.split("#")[0] === expectedUrl.split("#")[0]
    && /^\/i\/(?:history|bookmarks)\/?$/.test(location.pathname);
  const discover = (): {store: any; module: any} | undefined => {
    const stores = new Set<any>(), modules = new Set<any>(), seen = new Set<any>();
    for (const root of document.querySelectorAll('article, [data-testid="primaryColumn"]')) {
      for (const key of Object.getOwnPropertyNames(root)) {
        if (!key.startsWith("__reactFiber$") && !key.startsWith("__reactInternalInstance$")) continue;
        let fiber = own(root, key);
        for (let depth = 0; fiber && depth < 200 && !seen.has(fiber); depth++) {
          seen.add(fiber);
          const props = own(fiber, "memoizedProps"), store = own(props, "store");
          if (typeof own(store, "getState") === "function" && typeof own(store, "dispatch") === "function") stores.add(store);
          for (const name of ["module", "urtModule"]) {
            const module = own(props, name);
            if (typeof own(module, "timelineId") === "string") modules.add(module);
          }
          fiber = own(fiber, "return");
        }
      }
    }
    if (stores.size !== 1 || modules.size !== 1) return undefined;
    const module = [...modules][0], store = [...stores][0];
    if (own(module, "timelineId") !== "bookmarks" || own(module, "scopeId")
      || typeof own(module, "fetchBottom") !== "function") return undefined;
    return {store, module};
  };
  const read = (store: any): {end: boolean; cursor?: string} => {
    const state = own(store, "getState").call(store);
    const timeline = own(own(state, "urt"), "bookmarks");
    const entries = own(timeline, "entries");
    const bottom = Array.isArray(entries) ? entries.find(entry => own(entry, "type") === "timelineCursor"
      && own(own(entry, "content"), "cursorType") === "Bottom") : undefined;
    const cursor = own(own(bottom, "content"), "value");
    return {end: own(own(timeline, "terminatedStatus"), "atBottom") === true,
      ...(typeof cursor === "string" && cursor ? {cursor} : {})};
  };
  if (!samePage()) return {status: "unavailable"};
  const active = discover();
  if (!active) return {status: "unavailable"};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const before = read(active.store);
    if (before.end) return {status: "end"};
    if (!before.cursor) return {status: "unavailable"};
    // No direct API replay, credential extraction, scrolling, or parallel page requests.
    await Promise.race([
      Promise.resolve(own(active.store, "dispatch").call(active.store, own(active.module, "fetchBottom").call(active.module))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 15_000); }),
    ]);
    const current = discover();
    if (!samePage() || !current || current.store !== active.store || current.module !== active.module) return {status: "changed"};
    const after = read(active.store);
    if (after.end) return {status: "end"};
    if (!after.cursor || after.cursor === before.cursor) return {status: "stalled"};
    return {status: "advanced", cursor: after.cursor};
  } catch {
    const current = discover();
    return {status: !samePage() || !current || current.store !== active.store || current.module !== active.module ? "changed" : "failed"};
  }
  finally { clearTimeout(timer); }
}
