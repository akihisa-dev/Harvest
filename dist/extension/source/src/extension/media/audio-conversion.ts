import {runSingleWorker} from "./single-worker.js";
import { isConversionProgress, isAudioConversionReply, type AudioConversionRequest } from "../contracts/worker-contracts.js";
import { checkCancelled, MAX_IMAGE_BYTES } from "../contracts/image-data-contract.js";

/** One worker owns one conversion and is released on completion, failure, timeout, or cancellation. */
export function prepareAudio(blob: Blob, signal?: AbortSignal, maxBytes = MAX_IMAGE_BYTES, onProgress?: (fraction: number) => void): Promise<Blob> {
  checkCancelled(signal);
  if (!["video/mp4", "video/webm"].includes(blob.type)) return Promise.reject(new Error("選択項目と保存データの形式が一致しません。"));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return Promise.reject(new Error("音声データが保存容量の上限を超えています。"));
  if (typeof Worker === "undefined") return Promise.reject(new Error("この環境では動画から音声を取り出せません。"));
  return runSingleWorker<Blob>({
    create: () => new Worker(new URL("../workers/audio-conversion-worker.js", import.meta.url), {type: "module"}),
    request: {blob, maxBytes: Math.min(maxBytes, MAX_IMAGE_BYTES)} satisfies AudioConversionRequest,
    signal, timeoutMs: 120_000,
    abortError: () => new DOMException("音声の取り出しを中止しました。", "AbortError"),
    timeoutError: () => new Error("音声の取り出しがタイムアウトしました。"),
    failureError: () => new Error("この環境では動画から音声を取り出せません。"),
    receive: (data, finish) => {
      if (isConversionProgress(data)) {onProgress?.(data.progress); return;}
      if (!isAudioConversionReply(data)) finish(new Error("音声を取り出した結果が空です。"));
      else if (data.error) finish(new Error(data.error));
      else if (data.blob && data.blob.size > Math.min(maxBytes, MAX_IMAGE_BYTES)) finish(new Error("音声データが保存容量の上限を超えています。"));
      else if (data.blob) finish(undefined, data.blob);
      else finish(new Error("音声を取り出した結果が空です。"));
    },
  });
}
