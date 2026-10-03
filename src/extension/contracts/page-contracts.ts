import type { XMediaSnapshot, XPostSnapshot, XScanDiagnostics } from "../../core/x-media.js";

/** Serializable page evidence shared by injected readers and the extension receiver. */
export interface PageScan {
  url: string;
  title: string;
  xDiagnostics?: XScanDiagnostics;
  images: string[];
  media?: Array<{url: string; kind: "image" | "gif" | "video"; previewUrl?: string}>;
}

export interface XPageState {
  status: "ready" | "restricted" | "unavailable" | "timeout";
}

export interface BookmarkPageResult {
  status: "advanced" | "end" | "unavailable" | "stalled" | "failed" | "changed";
  cursor?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function diagnostics(value: unknown): value is XScanDiagnostics {
  if (!record(value) || typeof value["limited"] !== "boolean" || !optionalBoolean(value["bookmarkCaptureMissing"]) || !optionalBoolean(value["bookmarkIncomplete"]) || !optionalBoolean(value["bookmarkStopped"])) return false;
  return ["posts", "observed", "extracted", "merged", "excluded", "unavailable", "unresolved"].every(key => {
    const count = value[key];
    return typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  });
}

/** Shape validation only; media URL selection remains the responsibility of the existing parsers. */
export function isPageScan(value: unknown): value is PageScan {
  if (!record(value) || typeof value["url"] !== "string" || typeof value["title"] !== "string") return false;
  const images = value["images"], media = value["media"];
  return Array.isArray(images) && images.every(item => typeof item === "string")
    && (value["xDiagnostics"] === undefined || diagnostics(value["xDiagnostics"]))
    && (media === undefined || (Array.isArray(media) && media.every(item => record(item)
      && typeof item["url"] === "string" && (item["kind"] === "image" || item["kind"] === "gif" || item["kind"] === "video")
      && optionalString(item["previewUrl"]))));
}

export function isXPageState(value: unknown): value is XPageState {
  return record(value) && typeof value["status"] === "string"
    && ["ready", "restricted", "unavailable", "timeout"].includes(value["status"]);
}

export function isBookmarkPageResult(value: unknown): value is BookmarkPageResult {
  return record(value) && typeof value["status"] === "string"
    && ["advanced", "end", "unavailable", "stalled", "failed", "changed"].includes(value["status"])
    && optionalString(value["cursor"])
    && (value["status"] !== "advanced" || Boolean(value["cursor"]));
}

function postSnapshot(value: unknown): value is XPostSnapshot {
  if (!record(value) || typeof value["key"] !== "string" || !optionalString(value["postId"])) return false;
  const observed = value["observed"], roots = value["roots"];
  return Array.isArray(observed) && observed.every(item => record(item)
    && (item["kind"] === "image" || item["kind"] === "video")
    && optionalString(item["url"]) && optionalString(item["previewUrl"]))
    && Array.isArray(roots) && roots.every(root => record(root)
      && typeof root["requireIdentity"] === "boolean" && typeof root["player"] === "boolean");
  // roots[].value deliberately remains unknown; parseXMedia owns its bounded evidence traversal.
}

export function isXMediaSnapshot(value: unknown): value is XMediaSnapshot {
  return record(value) && typeof value["url"] === "string" && typeof value["limited"] === "boolean"
    && optionalBoolean(value["bookmarkCaptureMissing"]) && optionalBoolean(value["bookmarkContinuation"])
    && (value["bookmarkEpoch"] === undefined || (typeof value["bookmarkEpoch"] === "number"
      && Number.isSafeInteger(value["bookmarkEpoch"]) && value["bookmarkEpoch"] >= 0))
    && (value["bookmarkList"] === undefined || value["bookmarkList"] === "bookmarks" || value["bookmarkList"] === "other")
    && Array.isArray(value["posts"]) && value["posts"].every(postSnapshot);
}
