import type {PageScan} from "../contracts/page-contracts.js";
import {PageReadSession, withTemporaryPage} from "./page-read-session.js";
import {acquireXPage, xPageTarget, type ScanOptions} from "./x-page-acquisition.js";

export type {ScanOptions} from "./x-page-acquisition.js";

/** Public page access: read, acquire site evidence, then verify before publishing. */
export async function scanTab(tabId: number, signal?: AbortSignal, requestedUrl?: string, options: ScanOptions = {}): Promise<PageScan> {
  const session = new PageReadSession(tabId, signal);
  let result = await session.scanInitialPage();
  let checkBookmarkList = false;
  const target = xPageTarget(result.url, requestedUrl);
  if (target) ({result, checkBookmarkList} = await acquireXPage(session, result, target, signal, options));
  // X has its own post boundaries; unrelated embedded documents must not widen them.
  else if (result.hasFrames) result = {...result, frames: await session.scanFrames()};
  await session.verifyCurrentPage(checkBookmarkList);
  return result;
}

export function scanUrl(url: string, signal?: AbortSignal, options?: ScanOptions): Promise<PageScan> {
  return withTemporaryPage(url, signal, tabId => scanTab(tabId, signal, url, options));
}
