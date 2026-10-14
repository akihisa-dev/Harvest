import { isYoutubeMuxRequest } from "../contracts/worker-contracts.js";
import { muxYoutube } from "./youtube-mux.js";
const scope = self;
scope.addEventListener("message", event => {
    if (!isYoutubeMuxRequest(event.data))
        throw new Error("Workerへの要求が不正です。");
    const { video, audio, durations, maxBytes } = event.data;
    void muxYoutube(video, audio, durations, maxBytes).then(blob => scope.postMessage({ blob })).catch(() => scope.postMessage({ error: "YouTube動画の映像と音声をまとめられませんでした。" }));
});
