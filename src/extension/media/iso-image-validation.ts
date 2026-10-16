import {hasCompleteIsoImage} from "../../core/original-isobmff-image.js";
import {checkCancelled} from "../contracts/image-data-contract.js";

/** Transfer the existing byte buffer; terminate synchronous parsing on cancellation. */
export async function validateIsoImage(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<boolean> {
  checkCancelled(signal);
  if (typeof Worker === "undefined") return hasCompleteIsoImage(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/iso-image-validation-worker.js", import.meta.url), {type: "module"});
    let finished = false;
    const finish = (error?: Error, valid = false): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error); else resolve(valid);
    };
    const abort = (): void => finish(new DOMException("画像の検査を中止しました。", "AbortError"));
    const timer = setTimeout(() => finish(new Error("画像の検査がタイムアウトしました。")), 20000);
    worker.onmessage = (event: MessageEvent<unknown>): void => {
      if (typeof event.data !== "boolean") finish(new Error("画像の検査結果が不正です。"));
      else finish(undefined, event.data);
    };
    worker.onerror = worker.onmessageerror = () => finish(new Error("画像の検査に失敗しました。"));
    signal?.addEventListener("abort", abort, {once: true});
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage(bytes.buffer, [bytes.buffer]); }
    catch { finish(new Error("画像の検査に失敗しました。")); }
  });
}
