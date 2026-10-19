import { isAudioConversionRequest, type AudioConversionReply, type ConversionProgress, type WorkerMessageScope } from "../contracts/worker-contracts.js";
import { extractAudio } from "./audio-codec.js";

const scope = self as unknown as WorkerMessageScope<AudioConversionReply | ConversionProgress>;

scope.addEventListener("message", event => {
  if (!isAudioConversionRequest(event.data)) throw new Error("Workerへの要求が不正です。");
  let previous = -1;
  const report = (progress: number): void => {
    const percent = Math.floor(Math.max(0, Math.min(1, progress)) * 100);
    if (Number.isFinite(percent) && percent > previous) {previous = percent; scope.postMessage({progress: percent / 100});}
  };
  void extractAudio(event.data.blob, event.data.maxBytes, report).then(blob => {
    scope.postMessage({blob});
  }).catch(error => {
    const message = error instanceof Error && /[ぁ-んァ-ヶ一-龯]/u.test(error.message)
      ? error.message : "この環境では動画から音声を取り出せません。";
    scope.postMessage({error: message});
  });
});
