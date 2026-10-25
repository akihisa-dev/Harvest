import {MAX_MEDIA_BYTES} from "../../core/media-limits.js";
import {selectYoutubeFormats,youtubeStreamingUrl,type YoutubeSource,type YoutubeTrackDurations} from "../../core/youtube.js";
import {YoutubeSabrSession,youtubeAuthenticationError} from "../../core/youtube-sabr.js";
import {acquireYoutubeEvidence} from "../browser/youtube-page-access.js";
import {checkCancelled} from "../contracts/image-data-contract.js";
import {isMp4ConversionReply,type YoutubeMuxRequest} from "../contracts/worker-contracts.js";
import {fetchResponse,type ResponseFetchErrors} from "./response-fetch.js";
import {readMediaBytes} from "./image-response-bytes.js";
import {validateOriginalMedia} from "./original-media-validation.js";

const errors:ResponseFetchErrors={
  http:status=>new Error(status===401||status===403?youtubeAuthenticationError:"YouTubeの動画配信が取得を継続できませんでした。"),
  cancelled:()=>new Error("メディアの取得を中止しました。"),timeout:()=>new Error("メディアの取得がタイムアウトしました。"),
  failure:(error,{signal,sourceSignal})=>sourceSignal?.aborted?new Error("メディアの取得を中止しました。"):signal.aborted?new Error("メディアの取得がタイムアウトしました。"):error instanceof Error?error:new Error("メディアを取得できませんでした。"),
};
function delay(ms:number,signal?:AbortSignal):Promise<void>{
  checkCancelled(signal);
  return new Promise((resolve,reject)=>{
    const finish=()=>{signal?.removeEventListener("abort",abort);resolve();};
    const timer=setTimeout(finish,ms);
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);reject(new Error("メディアの取得を中止しました。"));};
    signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
  });
}
export function prepareYoutubeMp4(video:Blob|null,audio:Blob,durations:YoutubeTrackDurations,signal?:AbortSignal):Promise<Blob>{
  checkCancelled(signal);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("../workers/youtube-mux-worker.js",import.meta.url),{type:"module"});
    let settled=false;
    const finish=(error?:Error,blob?:Blob)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener("abort",abort);worker.terminate();if(error)reject(error);else if(blob)resolve(blob);};
    const abort=()=>finish(new Error("メディアの取得を中止しました。"));
    const timer=setTimeout(()=>finish(new Error("YouTube動画の結合がタイムアウトしました。")),120000);
    worker.onmessage=(event:MessageEvent<unknown>)=>{
      const reply=event.data;
      if(!isMp4ConversionReply(reply)||reply.error||!reply.blob||reply.blob.size>MAX_MEDIA_BYTES)finish(new Error("YouTube動画の映像と音声をまとめられませんでした。"));
      else finish(undefined,reply.blob);
    };
    worker.onerror=worker.onmessageerror=()=>finish(new Error("YouTube動画の映像と音声をまとめられませんでした。"));
    signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted){abort();return;}
    try{worker.postMessage({video,audio,durations,maxBytes:MAX_MEDIA_BYTES} satisfies YoutubeMuxRequest);}catch{finish(new Error("YouTube動画の映像と音声をまとめられませんでした。"));}
  });
}

/** One deadline covers authorization, retries, transfer, muxing, and validation. */
export async function fetchYoutubeVideo(source:YoutubeSource,signal?:AbortSignal,onProgress?:(fraction:number)=>void,audioOnly=false):Promise<Blob>{
  checkCancelled(signal);
  const controller=new AbortController();
  let reject!:(error:Error)=>void;
  const interrupted=new Promise<never>((_,no)=>{reject=no;});
  const abort=()=>{reject(errors.cancelled());controller.abort();};
  signal?.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(()=>{reject(errors.timeout());controller.abort();},120000);
  try{
    if(signal?.aborted)abort();
    return await Promise.race([fetchYoutubeWithinDeadline(source,controller.signal,onProgress,audioOnly),interrupted]);
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}

/** Refresh playback evidence per retry; never reuse partial data across tokens. */
async function fetchYoutubeWithinDeadline(source:YoutubeSource,signal:AbortSignal,onProgress?:(fraction:number)=>void,audioOnly=false):Promise<Blob>{
  let lastError:unknown;
  for(let attempt=0;attempt<2;attempt++){
    checkCancelled(signal);
    try{
      const evidence=await acquireYoutubeEvidence(source.videoId,true,signal);
      if(!evidence.capture)throw new Error(youtubeAuthenticationError);
      const {video,audio}=selectYoutubeFormats(evidence.formats);
      if(!audioOnly&&`${video.height}p${video.fps>30?video.fps:""}`!==source.quality)throw new Error("YouTube動画の画質情報が変わりました。もう一度解析してください。");
      const session=new YoutubeSabrSession(source.videoId,evidence.capture.url,new Uint8Array(evidence.capture.body),video,audio,MAX_MEDIA_BYTES,audioOnly);
      const started=performance.now();let lastProgressAt=started,totalTransferred=0;
      for(let request=0;request<2048&&!session.complete;request++){
        checkCancelled(signal);
        if(performance.now()-started>120000)throw new Error("メディアの取得がタイムアウトしました。");
        const before=session.receivedBytes,endpoint=new URL(youtubeStreamingUrl(session.url));
        endpoint.searchParams.set("alr","no");endpoint.searchParams.set("rn",String(request));
        const bytes=await fetchResponse(endpoint.href,{method:"POST",body:session.request(Math.round(performance.now()-started)),timeoutMs:Math.min(30000,Math.max(1,120000-(performance.now()-started))),...(signal?{signal}:{})},errors,async response=>{
          const type=response.headers.get("content-type")?.split(";")[0]?.trim();
          if(type!=="application/vnd.yt-ump"&&type!=="application/octet-stream")throw new Error("YouTubeの配信データが不完全または未対応です。");
          return readMediaBytes(response);
        });
        totalTransferred+=bytes.length;if(totalTransferred>MAX_MEDIA_BYTES*3)throw new Error("YouTubeの動画配信が取得を継続できませんでした。");
        session.ingest(bytes);
        const expectedBytes=audioOnly?audio.contentLength:video.contentLength+audio.contentLength;
        const fraction=expectedBytes>0 ? session.receivedBytes/expectedBytes
          : session.progressMs/(audioOnly?audio.durationMs:Math.max(video.durationMs,audio.durationMs));
        onProgress?.(Math.min(.95, .95 * fraction));
        const progressed=session.receivedBytes>before;
        if(progressed)lastProgressAt=performance.now();
        if(!session.complete&&performance.now()-lastProgressAt>=30000)throw new Error("YouTubeの動画配信が取得を継続できませんでした。");
        const waitMs=Math.max(session.backoffMs,progressed?0:500);
        if(!session.complete&&waitMs>0)await delay(waitMs,signal);
      }
      const output=session.output();checkCancelled(signal);
      const blob=await prepareYoutubeMp4(audioOnly?null:new Blob([output.video],{type:"video/mp4"}),new Blob([output.audio],{type:"audio/mp4"}),output.durations,signal);
      if(!audioOnly)await validateOriginalMedia(blob,signal);onProgress?.(1);return blob;
    }catch(error){lastError=error;if(signal?.aborted||!(error instanceof Error)||error.message!==youtubeAuthenticationError)throw error;}
  }
  throw lastError;
}
