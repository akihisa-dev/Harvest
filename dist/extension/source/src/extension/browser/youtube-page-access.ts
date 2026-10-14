import {selectYoutubeFormats,youtubeVideoId,youtubeVideoUrl,type YoutubeSource} from "../../core/youtube.js";
import {readYoutubePage} from "../content/youtube-page.js";
import {manageYoutubeFrame} from "../content/youtube-frame.js";
import {isYoutubePageEvidence,type YoutubePageEvidence} from "../contracts/youtube-contracts.js";
import type {PageScan} from "../contracts/page-contracts.js";

/** Own a disposable frame, leaving the host tab and its player untouched. */
export async function acquireYoutubeEvidence(videoId:string, capture:boolean, signal?:AbortSignal):Promise<YoutubePageEvidence>{
  signal?.throwIfAborted();
  youtubeVideoUrl(videoId);
  const tabs=await chrome.tabs.query({});
  signal?.throwIfAborted();
  const web=tabs.filter(tab=>tab.id!==undefined&&tab.url?.startsWith("https://"));
  const existing=web.filter(tab=>{try{const url=new URL(tab.url!);return url.origin==="https://www.youtube.com"&&url.pathname==="/watch"&&youtubeVideoId(url.href)===videoId;}catch{return false;}})
    .sort((a,b)=>Number(Boolean(b.active))-Number(Boolean(a.active)))[0];
  if(!capture&&existing?.id!==undefined)return readExistingYoutube(existing.id,videoId,signal);
  const tab=web.find(tab=>{try{return new URL(tab.url!).origin==="https://www.youtube.com";}catch{return false;}})
    ??web.find(tab=>tab.active)??web[0];
  if(tab?.id===undefined)throw new Error("YouTubeの取得にはWebページを開いたタブが必要です。");
  const tabId=tab.id,owner=`harvest-youtube-${crypto.randomUUID()}`;
  let parentDocument:string|undefined,parentUrl:string|undefined,timeout:ReturnType<typeof setTimeout>|undefined;
  let stopped=false,reject!:(error:Error)=>void;
  const interrupted=new Promise<never>((_,no)=>{reject=no;});
  const stop=(error:Error)=>{stopped=true;reject(error);};
  const abort=()=>stop(new Error("ページの解析を終了しました。"));
  const removed=(id:number)=>{if(id===tabId)stop(new Error("解析中のタブが閉じられました。"));};
  const moved=(id:number,change:{status?:string})=>{if(id===tabId&&change.status==="loading")stop(new Error("解析中にページが移動しました。もう一度解析してください。"));};
  signal?.addEventListener("abort",abort,{once:true});
  chrome.tabs.onRemoved.addListener(removed);chrome.tabs.onUpdated.addListener(moved);
  timeout=setTimeout(()=>stop(new Error("YouTubeの動画情報の読み取りが時間切れになりました。")),90000);
  const operation=(async()=>{
    const [created]=await chrome.scripting.executeScript({target:{tabId},func:manageYoutubeFrame,args:[videoId,owner,false]});
    parentDocument=created?.documentId;parentUrl=created?.result;
    if(stopped||signal?.aborted)return undefined;
    if(!parentDocument||typeof parentUrl!=="string")throw new Error("YouTubeの動画情報を確認できませんでした。");
    while(!stopped){
      const entries=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:"MAIN",func:readYoutubePage,args:[videoId,capture,owner]});
      if(stopped||signal?.aborted)return undefined;
      const entry=entries.find(row=>row.result!==undefined&&row.result!==null);
      if(entry){
        if(!entry.documentId||!isYoutubePageEvidence(entry.result)||entry.result.videoId!==videoId)throw new Error("YouTubeの動画情報を確認できませんでした。");
        if(entry.result.error)throw new Error(entry.result.error);
        const [now]=await chrome.scripting.executeScript({target:{tabId},func:()=>location.href});
        if(stopped||now?.documentId!==parentDocument||now?.result!==parentUrl)throw new Error("解析中にページが移動しました。もう一度解析してください。");
        const frames=await chrome.scripting.executeScript({target:{tabId,documentIds:[entry.documentId]},world:"MAIN",func:(name:string)=>window.name===name||location.hash===`#${name}`,args:[owner]});
        if(stopped||frames[0]?.documentId!==entry.documentId||frames[0]?.result!==true)throw new Error("解析中にページが移動しました。もう一度解析してください。");
        return entry.result;
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return undefined;
  })();
  try{
    if(signal?.aborted)abort();
    const evidence=await Promise.race([operation,interrupted]);
    if(!evidence)throw new Error("ページの解析を終了しました。");
    return evidence;
  }finally{
    stopped=true;if(timeout)clearTimeout(timeout);
    signal?.removeEventListener("abort",abort);chrome.tabs.onRemoved.removeListener(removed);chrome.tabs.onUpdated.removeListener(moved);
    // Wait for creation even after cancellation so a late frame is removed too.
    if(!parentDocument)await operation.catch(()=>undefined);
    if(parentDocument)await chrome.scripting.executeScript({target:{tabId,documentIds:[parentDocument]},func:manageYoutubeFrame,args:[videoId,owner,true]}).catch(()=>undefined);
  }
}

/** Analysis of an open watch page is read-only and creates no player/frame. */
async function readExistingYoutube(tabId:number,videoId:string,signal?:AbortSignal):Promise<YoutubePageEvidence>{
  let timeout:ReturnType<typeof setTimeout>|undefined,reject!:(error:Error)=>void;
  const interrupted=new Promise<never>((_,no)=>{reject=no;});
  let stopped=false;
  const stop=(error:Error)=>{stopped=true;reject(error);};
  const abort=()=>stop(new Error("ページの解析を終了しました。"));
  const removed=(id:number)=>{if(id===tabId)stop(new Error("解析中のタブが閉じられました。"));};
  signal?.addEventListener("abort",abort,{once:true});chrome.tabs.onRemoved.addListener(removed);
  timeout=setTimeout(()=>stop(new Error("YouTubeの動画情報の読み取りが時間切れになりました。")),20000);
  try{
    if(signal?.aborted)abort();
    const operation=(async()=>{
      const [entry]=await chrome.scripting.executeScript({target:{tabId},world:"MAIN",func:readYoutubePage,args:[videoId,false]});
      if(stopped)throw new Error("ページの解析を終了しました。");
      if(!entry?.documentId||!isYoutubePageEvidence(entry.result)||entry.result.videoId!==videoId)throw new Error("YouTubeの動画情報を確認できませんでした。");
      if(entry.result.error)throw new Error(entry.result.error);
      const [now]=await chrome.scripting.executeScript({target:{tabId},func:()=>location.href});
      if(stopped||now?.documentId!==entry.documentId||youtubeVideoId(String(now?.result))!==videoId)throw new Error("解析中にページが移動しました。もう一度解析してください。");
      return entry.result;
    })();
    return await Promise.race([operation,interrupted]);
  }finally{stopped=true;if(timeout)clearTimeout(timeout);signal?.removeEventListener("abort",abort);chrome.tabs.onRemoved.removeListener(removed);}
}

export async function scanYoutube(videoId:string,signal?:AbortSignal):Promise<PageScan>{
  const evidence=await acquireYoutubeEvidence(videoId,false,signal);
  const {video,audio}=selectYoutubeFormats(evidence.formats);
  const total=video.contentLength+audio.contentLength;
  const youtube:YoutubeSource={videoId,quality:`${video.height}p${video.fps>30?video.fps:""}`,...(video.contentLength&&audio.contentLength?{bytes:total}:{})};
  const url=youtubeVideoUrl(videoId);
  return {url,title:evidence.title,images:[],media:[{url,kind:"video",youtube,...(evidence.previewUrl?{previewUrl:evidence.previewUrl}:{})}]};
}
