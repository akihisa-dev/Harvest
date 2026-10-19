import {streamDownloadUrl, type StreamRecording} from "../../core/stream-recording.js";

export const streamAccessError = "録画をダウンロードできません。ダウンロード権限とMicrosoft 365へのログイン状態を確認してください。";

/** HEAD checks the official download route without buffering any recording data. */
export async function inspectStreamRecording(pageUrl: string, signal?: AbortSignal): Promise<StreamRecording> {
  const url = streamDownloadUrl(pageUrl);
  if (!url) throw new Error("録画ファイルを特定できません。Streamの録画再生ページを開いて解析してください。");
  signal?.throwIfAborted();
  const requestSignal = AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
  try {
    const response = await fetch(url, {method: "HEAD", credentials: "include", redirect: "error", cache: "no-store", signal: requestSignal,
      ...({targetAddressSpace: "public"} as RequestInit)});
    try {
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      const disposition = response.headers.get("content-disposition") ?? "";
      // Login/error pages, DASH/HLS and non-video documents cannot become MP4 results.
      if (response.status !== 200 || (type !== "video/mp4"
        && !(type === "application/octet-stream" && /filename\*?\s*=.*\.mp4(?:[";\s]|$)/i.test(disposition)))) throw new Error(streamAccessError);
      const length = response.headers.get("content-length");
      const bytes = length && /^\d+$/.test(length) ? Number(length) : undefined;
      if (bytes === 0 || response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity") throw new Error(streamAccessError);
      return {pageUrl, ...(bytes !== undefined && Number.isSafeInteger(bytes) && bytes > 0 ? {bytes} : {})};
    } finally { await response.body?.cancel(); }
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (requestSignal.aborted) throw new Error("録画のダウンロード権限の確認が時間切れになりました。もう一度お試しください。");
    throw error instanceof Error && error.message === streamAccessError ? error : new Error(streamAccessError);
  }
}
