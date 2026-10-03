import {validateOriginalMedia} from "./original-media-validation.js";
import type { Mp4ConversionRequest, Mp4ConversionReply } from "./worker-contracts.js";
import { checkCancelled, MAX_IMAGE_BYTES } from "./image-data-contract.js";

/** One worker owns one conversion and is released on completion, failure, timeout, or cancellation. */
export function prepareMp4(blob: Blob, signal?: AbortSignal, maxBytes = MAX_IMAGE_BYTES): Promise<Blob> {
  checkCancelled(signal);
  if (blob.type === "video/mp4") return validateOriginalMedia(blob, signal).then(() => blob);
  if (blob.type !== "video/webm") return Promise.reject(new Error("選択項目と保存データの形式が一致しません。"));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return Promise.reject(new Error("MP4変換後の動画が保存容量の上限を超えています。"));
  if (typeof Worker === "undefined") return Promise.reject(new Error("この環境では動画の映像または音声をMP4へ変換できません。"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mp4-conversion-worker.js", import.meta.url), {type: "module"});
    let finished = false;
    const finish = (error?: Error, converted?: Blob): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else if (converted) resolve(converted);
    };
    const abort = (): void => finish(new DOMException("動画の変換を中止しました。", "AbortError"));
    const timeout = setTimeout(() => finish(new Error("MP4への変換がタイムアウトしました。")), 120_000);
    worker.onmessage = (event: MessageEvent<Mp4ConversionReply>) => {
      if (event.data.error) finish(new Error(event.data.error));
      else if (event.data.blob instanceof Blob && event.data.blob.type === "video/mp4" && event.data.blob.size > 0) finish(undefined, event.data.blob);
      else finish(new Error("MP4への変換結果が空です。"));
    };
    worker.onerror = worker.onmessageerror = () => finish(new Error("動画をMP4へ変換できませんでした。"));
    signal?.addEventListener("abort", abort, {once: true});
    if (signal?.aborted) {
      abort();
      return;
    }
    try { worker.postMessage({blob, maxBytes: Math.min(maxBytes, MAX_IMAGE_BYTES)} satisfies Mp4ConversionRequest); }
    catch { finish(new Error("動画をMP4へ変換できませんでした。")); }
  });
}
