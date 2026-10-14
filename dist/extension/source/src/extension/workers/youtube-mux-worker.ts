import {isYoutubeMuxRequest,type Mp4ConversionReply,type WorkerMessageScope} from "../contracts/worker-contracts.js";
import {muxYoutube} from "./youtube-mux.js";

const scope=self as unknown as WorkerMessageScope<Mp4ConversionReply>;
scope.addEventListener("message",event=>{
  if(!isYoutubeMuxRequest(event.data))throw new Error("Workerへの要求が不正です。");
  const {video,audio,durationMs,maxBytes}=event.data;
  void muxYoutube(video,audio,durationMs,maxBytes).then(blob=>scope.postMessage({blob})).catch(()=>scope.postMessage({error:"YouTube動画の映像と音声をまとめられませんでした。"}));
});
