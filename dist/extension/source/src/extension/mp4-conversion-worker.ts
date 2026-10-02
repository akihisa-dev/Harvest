import { convertWebmToMp4 } from "./mp4-codec.js";

const scope = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<{blob: Blob; maxBytes: number}>) => void): void;
  postMessage(message: {blob?: Blob; error?: string}): void;
};

scope.addEventListener("message", event => {
  void convertWebmToMp4(event.data.blob, event.data.maxBytes).then(blob => {
    scope.postMessage({blob});
  }).catch(error => {
    const message = error instanceof Error && /[ぁ-んァ-ヶ一-龯]/u.test(error.message)
      ? error.message : "動画をMP4へ変換できませんでした。";
    scope.postMessage({error: message});
  });
});
