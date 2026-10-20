import {hasCompleteWebm} from "../../core/webm-structure.js";
import {checkCancelled} from "../contracts/image-data-contract.js";

/** Transfer the existing byte buffer; terminate synchronous parsing on cancellation. */
export async function validateWebm(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<boolean> {
  checkCancelled(signal);
  if (typeof Worker === "undefined") return hasCompleteWebm(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/webm-validation-worker.js", import.meta.url), {type: "module"});
    let finished = false;
    const finish = (error?: Error, valid = false): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error); else resolve(valid);
    };
    const abort = (): void => finish(new DOMException("動画の検査を中止しました。", "AbortError"));
    const timer = setTimeout(() => finish(new Error("動画の検査がタイムアウトしました。")), 20000);
    worker.onmessage = (event: MessageEvent<unknown>): void => {
      if (typeof event.data !== "boolean") finish(new Error("動画の検査結果が不正です。"));
      else finish(undefined, event.data);
    };
    worker.onerror = worker.onmessageerror = () => finish(new Error("動画の検査に失敗しました。"));
    signal?.addEventListener("abort", abort, {once: true});
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage(bytes.buffer, [bytes.buffer]); }
    catch { finish(new Error("動画の検査に失敗しました。")); }
  });
}
