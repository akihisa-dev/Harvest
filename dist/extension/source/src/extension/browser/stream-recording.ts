import {streamDownloadUrl, isStreamMp4Content, type StreamRecording} from "../../core/stream-recording.js";

export const streamAccessError = "録画の形式または容量が取得情報と一致しません。";
export const streamNetworkError = "録画の取得先に接続できませんでした。通信または転送先の確認に失敗しました。";

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
      // Login/error pages, DASH/HLS and non-video documents cannot become MP4 results.
      if (response.status === 401) throw new Error("録画の取得先でログインが必要です（HTTP 401）。");
      if (response.status === 403) throw new Error("保存用の取得先がリクエストを拒否しました（HTTP 403）。");
      if (response.status === 404) throw new Error("録画の取得先が見つかりません（HTTP 404）。");
      if (response.status !== 200) throw new Error("録画の取得先がエラーを返しました。");
      if (!isStreamMp4Content(response.headers.get("content-type"), response.headers.get("content-disposition"))) throw new Error("録画の取得先が動画以外のデータを返しました。ログイン画面などの可能性があります。");
      const length = response.headers.get("content-length");
      const bytes = length && /^\d+$/.test(length) ? Number(length) : undefined;
      if (bytes === 0 || response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity") throw new Error(streamAccessError);
      return {pageUrl, ...(bytes !== undefined && Number.isSafeInteger(bytes) && bytes > 0 ? {bytes} : {})};
    } finally { await response.body?.cancel(); }
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (requestSignal.aborted) throw new Error("録画の取得先の確認が時間切れになりました。もう一度お試しください。");
    if (error instanceof TypeError) throw new Error(streamNetworkError);
    throw error instanceof Error ? error : new Error(streamNetworkError);
  }
}
