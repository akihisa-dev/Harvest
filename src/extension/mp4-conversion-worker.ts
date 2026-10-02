import type { Mp4ConversionRequest, Mp4ConversionReply, WorkerMessageScope } from "./worker-contracts.js";
import { convertWebmToMp4 } from "./mp4-codec.js";

const scope = self as unknown as WorkerMessageScope<Mp4ConversionRequest, Mp4ConversionReply>;

scope.addEventListener("message", event => {
  void convertWebmToMp4(event.data.blob, event.data.maxBytes).then(blob => {
    scope.postMessage({blob});
  }).catch(error => {
    const message = error instanceof Error && /[ぁ-んァ-ヶ一-龯]/u.test(error.message)
      ? error.message : "動画をMP4へ変換できませんでした。";
    scope.postMessage({error: message});
  });
});
