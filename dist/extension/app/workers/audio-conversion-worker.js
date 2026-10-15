import { isAudioConversionRequest } from "../contracts/worker-contracts.js";
import { extractAudio } from "./audio-codec.js";
const scope = self;
scope.addEventListener("message", event => {
    if (!isAudioConversionRequest(event.data))
        throw new Error("Workerへの要求が不正です。");
    void extractAudio(event.data.blob, event.data.maxBytes).then(blob => {
        scope.postMessage({ blob });
    }).catch(error => {
        const message = error instanceof Error && /[ぁ-んァ-ヶ一-龯]/u.test(error.message)
            ? error.message : "この環境では動画から音声を取り出せません。";
        scope.postMessage({ error: message });
    });
});
