import {MAX_MEDIA_BYTES} from "../../core/media-limits.js";
import {runSingleWorker} from "./single-worker.js";
import {validateOriginalMedia} from "./original-media-validation.js";
import { isConversionProgress, isMp4ConversionReply, type Mp4ConversionRequest } from "../contracts/worker-contracts.js";
import { checkCancelled } from "../contracts/image-data-contract.js";

/** One worker owns one conversion and is released on completion, failure, timeout, or cancellation. */
export function prepareMp4(blob: Blob, signal?: AbortSignal, maxBytes = MAX_MEDIA_BYTES, onProgress?: (fraction: number) => void): Promise<Blob> {
  checkCancelled(signal);
  if (blob.type === "video/mp4") return validateOriginalMedia(blob, signal).then(() => blob);
  if (blob.type !== "video/webm") return Promise.reject(new Error("選択項目と保存データの形式が一致しません。"));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return Promise.reject(new Error("MP4変換後の動画が保存容量の上限を超えています。"));
  if (typeof Worker === "undefined") return Promise.reject(new Error("この環境では動画の映像または音声をMP4へ変換できません。"));
  return runSingleWorker<Blob>({
    create: () => new Worker(new URL("../workers/mp4-conversion-worker.js", import.meta.url), {type: "module"}),
    request: {blob, maxBytes: Math.min(maxBytes, MAX_MEDIA_BYTES)} satisfies Mp4ConversionRequest,
    signal, timeoutMs: 120_000,
    abortError: () => new DOMException("動画の変換を中止しました。", "AbortError"),
    timeoutError: () => new Error("MP4への変換がタイムアウトしました。"),
    failureError: () => new Error("動画をMP4へ変換できませんでした。"),
    receive: (data, finish) => {
      if (isConversionProgress(data)) {onProgress?.(data.progress); return;}
      if (!isMp4ConversionReply(data)) finish(new Error("MP4への変換結果が空です。"));
      else if (data.error) finish(new Error(data.error));
      else if (data.blob && data.blob.size > Math.min(maxBytes, MAX_MEDIA_BYTES)) finish(new Error("MP4変換後の動画が保存容量の上限を超えています。"));
      else if (data.blob) finish(undefined, data.blob);
      else finish(new Error("MP4への変換結果が空です。"));
    },
  });
}
