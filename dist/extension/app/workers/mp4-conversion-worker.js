import { isMp4ConversionRequest } from "../contracts/worker-contracts.js";
import { convertWebmToMp4 } from "./mp4-codec.js";
const scope = self;
scope.addEventListener("message", event => {
    if (!isMp4ConversionRequest(event.data))
        throw new Error("Workerへの要求が不正です。");
    void convertWebmToMp4(event.data.blob, event.data.maxBytes).then(blob => {
        scope.postMessage({ blob });
    }).catch(error => {
        const message = error instanceof Error && /[ぁ-んァ-ヶ一-龯]/u.test(error.message)
            ? error.message : "動画をMP4へ変換できませんでした。";
        scope.postMessage({ error: message });
    });
});
