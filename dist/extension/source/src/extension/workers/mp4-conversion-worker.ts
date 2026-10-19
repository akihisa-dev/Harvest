import { isMp4ConversionRequest, type Mp4ConversionReply, type ConversionProgress, type WorkerMessageScope } from "../contracts/worker-contracts.js";
import { convertWebmToMp4 } from "./mp4-codec.js";

const scope = self as unknown as WorkerMessageScope<Mp4ConversionReply | ConversionProgress>;

scope.addEventListener("message", event => {
  if (!isMp4ConversionRequest(event.data)) throw new Error("Workerへの要求が不正です。");
  let previous = -1;
  const report = (progress: number): void => {
    const percent = Math.floor(Math.max(0, Math.min(1, progress)) * 100);
    if (Number.isFinite(percent) && percent > previous) {previous = percent; scope.postMessage({progress: percent / 100});}
  };
  void convertWebmToMp4(event.data.blob, event.data.maxBytes, report).then(blob => {
    scope.postMessage({blob});
  }).catch(error => {
    const message = error instanceof Error && /[ぁ-んァ-ヶ一-龯]/u.test(error.message)
      ? error.message : "動画をMP4へ変換できませんでした。";
    scope.postMessage({error: message});
  });
});
