import { isAnimationConversionRequest } from "../contracts/worker-contracts.js";
import { convertAnimatedImage } from "./animation-codec.js";
const scope = self;
scope.addEventListener("message", event => {
    if (!isAnimationConversionRequest(event.data))
        throw new Error("Workerへの要求が不正です。");
    void convertAnimatedImage(event.data.blob, event.data.maxBytes).then(blob => scope.postMessage({ blob })).catch(error => scope.postMessage({ error: error instanceof Error && /[ぁ-んァ-ヶ一-龯]/u.test(error.message) ? error.message : "アニメーション画像のデータが不完全または破損しています。" }));
});
