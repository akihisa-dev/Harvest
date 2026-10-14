import type {YoutubePageEvidence} from "../contracts/youtube-contracts.js";

/** Captures in an owned frame or restores an existing player. Helpers survive serialization. */
export async function readYoutubePage(videoId: string, capturePlayback: boolean, owner?:string, restorePlayback=false, requestOwner?:string): Promise<YoutubePageEvidence|undefined> {
  if(owner&&window.name!==owner&&location.hash!==`#${owner}`)return undefined;
  const empty=(error: string): YoutubePageEvidence=>({videoId,title:"",previewUrl:"",formats:[],error});
  const watch=location.pathname==="/watch"&&new URL(location.href).searchParams.get("v")===videoId;
  const embed=Boolean(owner)&&location.pathname===`/embed/${videoId}`;
  if(location.origin!=="https://www.youtube.com"||(!watch&&!embed))return owner?undefined:empty("YouTubeの対象動画を確認できませんでした。");
  const controls=(window as unknown as Record<symbol,Map<string,{cancelled:boolean}>|undefined>)[Symbol.for("harvest.youtube.capture.controls")];
  const control=requestOwner?controls?.get(requestOwner):undefined;
  const cancelled=():boolean=>Boolean(requestOwner&&(!control||control.cancelled));
  if(cancelled())return empty("ページの解析を終了しました。");
  const initialUrl=location.href;
  const record=(value: unknown): Record<string,unknown>|undefined=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
  const source=(): Record<string,unknown>|undefined=>{
    const player=document.getElementById("movie_player") as HTMLElement&{getPlayerResponse?:()=>unknown}|null;
    try{return record(player?.getPlayerResponse?.());}catch{return undefined;}
  };
  const deadline=performance.now()+15000;
  const wait=():Promise<void>=>new Promise(resolve=>setTimeout(resolve,100));
  let response: Record<string,unknown>|undefined;
  while(performance.now()<deadline){
    if(cancelled())return empty("ページの解析を終了しました。");
    if(location.href!==initialUrl)return empty("解析中にページが移動しました。もう一度解析してください。");
    response=source();
    if(record(response?.["videoDetails"])?.["videoId"]===videoId)break;
    await wait();
  }
  const details=record(response?.["videoDetails"]),status=record(response?.["playabilityStatus"]);
  if(details?.["videoId"]!==videoId)return empty("YouTubeの動画情報を読み取れませんでした。");
  if(status?.["status"]!=="OK")return empty("このYouTube動画は通常の公開再生を確認できませんでした。");
  if(details["isLive"]||details["isLiveContent"]||record(response?.["microformat"])?.["liveBroadcastDetails"])return empty("YouTubeのライブ動画は保存に対応していません。");
  const formats: YoutubePageEvidence["formats"]=[];
  const adaptive=record(response?.["streamingData"])?.["adaptiveFormats"];
  if(Array.isArray(adaptive)&&adaptive.length<=128){
    for(const raw of adaptive){
      const f=record(raw);if(!f)continue;
      const numeric=(value:unknown):number=>typeof value==="number"?value:typeof value==="string"&&/^\d+$/.test(value)?Number(value):0;
      const audio=record(f["audioTrack"]);
      const duration=numeric(f["approxDurationMs"]);
      if(typeof f["mimeType"]!=="string"||typeof f["lastModified"]!=="string"||duration<=0)continue;
      formats.push({itag:numeric(f["itag"]),lastModified:f["lastModified"],xtags:typeof f["xtags"]==="string"?f["xtags"]:"",
        mimeType:f["mimeType"],contentLength:numeric(f["contentLength"]),durationMs:duration,height:numeric(f["height"]),fps:numeric(f["fps"]),bitrate:numeric(f["bitrate"]),
        language:typeof audio?.["id"]==="string"?audio["id"]:"",defaultAudio:audio?.["audioIsDefault"]===true});
    }
  }
  const thumbnails=record(details["thumbnail"])?.["thumbnails"];
  let previewUrl="";
  if(Array.isArray(thumbnails))for(const thumbnail of thumbnails){
    const url=record(thumbnail)?.["url"];
    if(typeof url==="string"){try{const u=new URL(url);if(u.protocol==="https:"&&/^(?:i|i\d)\.ytimg\.com$/.test(u.hostname))previewUrl=u.href;}catch{/* Ignore malformed previews. */}}
  }
  const title=typeof details["title"]==="string"?details["title"].slice(0,4096):document.title;
  const evidence: YoutubePageEvidence={videoId,title,previewUrl,formats};
  if(!capturePlayback)return evidence;

  let capture: YoutubePageEvidence["capture"];
  // Keep a bounded native proof token; downstream responses validate authorization.
  const tokenLength=(data:Uint8Array,fieldId:number):Uint8Array|undefined=>{
    let offset=0;
    const integer=():number=>{let value=0,mul=1;for(let i=0;i<10&&offset<data.length;i++){const byte=data[offset++]!;value+=(byte&127)*mul;if(byte<128)return value;mul*=128;}throw new Error("Invalid wire");};
    while(offset<data.length){const tag=integer(),kind=tag&7;let size=0;if(kind===0){integer();continue;}if(kind===1)size=8;else if(kind===5)size=4;else if(kind===2)size=integer();else return undefined;
      if(size<0||size>data.length-offset)return undefined;const value=data.subarray(offset,offset+size);offset+=size;if(tag>>>3===fieldId&&kind===2)return value;}
    return undefined;
  };
  const inspect=(url:string,body:unknown):void=>{
    try{
      if(cancelled())return;
      const target=new URL(url,location.href);
      if(location.href!==initialUrl||target.protocol!=="https:"||!target.hostname.endsWith(".googlevideo.com")||target.pathname!=="/videoplayback"||target.searchParams.get("sabr")!=="1")return;
      const bytes=body instanceof ArrayBuffer?new Uint8Array(body):ArrayBuffer.isView(body)?new Uint8Array(body.buffer,body.byteOffset,body.byteLength):undefined;
      if(!bytes||bytes.length>65536)return;
      // The watch page also prefetches recommendations. A valid proof token does
      // not identify the video: bind the request to this player's stream config.
      const current=source();
      if(record(current?.["videoDetails"])?.["videoId"]!==videoId)return;
      const common=record(record(current?.["playerConfig"])?.["mediaCommonConfig"]);
      const config=record(common?.["mediaUstreamerRequestConfig"])?.["videoPlaybackUstreamerConfig"];
      if(typeof config!=="string"||config.length>90000)return;
      const expected=Uint8Array.from(atob(config.replace(/-/g,"+").replace(/_/g,"/")),char=>char.charCodeAt(0));
      const actual=tokenLength(bytes,5);
      if(!actual||!expected.length||actual.length!==expected.length||actual.some((byte,index)=>byte!==expected[index]))return;
      const context=tokenLength(bytes,19),token=context?tokenLength(context,2):undefined;
      if(token&&token.length>=16)capture={url:target.href,body:Array.from(bytes)};
    }catch{/* Observation must never affect native playback. */}
  };
  const observe=(url:string,body:unknown):void=>{
    try{const target=new URL(url,location.href);
      if(target.protocol!=="https:"||!target.hostname.endsWith(".googlevideo.com")||target.pathname!=="/videoplayback"||target.searchParams.get("sabr")!=="1")return;
    }catch{return;}
    inspect(url,body);
    if(body instanceof Blob){if(body.size<=65536)void body.arrayBuffer().then(bytes=>inspect(url,bytes)).catch(()=>{});}
    else if(typeof Request!=="undefined"&&body instanceof Request){
      // Read only a bounded clone: consuming the native Request would break playback.
      void (async()=>{
        const reader=body.clone().body?.getReader();if(!reader)return;
        const chunks:Uint8Array[]=[];let length=0;
        const timer=setTimeout(()=>{void reader.cancel().catch(()=>{});},15000);
        try{
          while(true){const {done,value}=await reader.read();if(done)break;
            if(value.length>65536-length)return;chunks.push(value);length+=value.length;}
          const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
          inspect(url,bytes);
        }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
      })().catch(()=>{});
    }
  };
  const originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send,originalFetch=window.fetch;
  const urls=new WeakMap<XMLHttpRequest,string>();
  const open:typeof originalOpen=function(this:XMLHttpRequest,method:string,url:string|URL,async?:boolean,username?:string|null,password?:string|null):void{
    urls.set(this,String(url));Reflect.apply(originalOpen,this,async===undefined?[method,url]:[method,url,async,username,password]);
  };
  const send=function(this:XMLHttpRequest,body?:Document|XMLHttpRequestBodyInit|null):void{observe(urls.get(this)??"",body);Reflect.apply(originalSend,this,[body]);};
  const fetcher: typeof fetch=function(this:Window,input,init){
    const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    observe(url,init?.body??input);
    return Reflect.apply(originalFetch,this,[input,init]);
  };
  const video=document.querySelector<HTMLVideoElement>("#movie_player video");
  if(!video)return empty("YouTubeの動画プレイヤーを読み取れませんでした。");
  // Injected readers can outlive their cancelled caller. Never nest wrappers or
  // let one capture restore playback while another capture is still running.
  const captureKey=Symbol.for("harvest.youtube.capture");
  const captures=window as unknown as Record<symbol,boolean|undefined>;
  if(captures[captureKey])return empty("YouTubeの保存準備が続いています。少し待ってからもう一度保存してください。");
  const playback={time:video.currentTime,muted:video.muted,volume:video.volume,rate:video.playbackRate,paused:video.paused};
  captures[captureKey]=true;
  try{
    XMLHttpRequest.prototype.open=open;XMLHttpRequest.prototype.send=send;window.fetch=fetcher;
    video.muted=true;
    // Loading may have filled the native buffer before observation began. Merely
    // playing it again would not issue a request within the capture deadline.
    const player=document.getElementById("movie_player") as HTMLElement&{mute?:()=>void;loadVideoById?:(id:string,start:number)=>void}|null;
    if(player?.loadVideoById&&player.mute){player.mute();player.loadVideoById(videoId,0);}
    else void video.play().catch(()=>{});
    const captureDeadline=performance.now()+15000;
    while(performance.now()<captureDeadline&&!capture){if(cancelled())return empty("ページの解析を終了しました。");if(location.href!==initialUrl)return empty("解析中にページが移動しました。もう一度解析してください。");await wait();}
    if(!capture)return empty("YouTubeの取得用認証を読み取れませんでした。もう一度保存をお試しください。");
    return {...evidence,capture};
  }finally{
    // Restore wrappers and release ownership before fallible player operations.
    if(XMLHttpRequest.prototype.open===open)XMLHttpRequest.prototype.open=originalOpen;
    if(XMLHttpRequest.prototype.send===send)XMLHttpRequest.prototype.send=originalSend;
    if(window.fetch===fetcher)window.fetch=originalFetch;
    delete captures[captureKey];
    const attempt=(action:()=>void):void=>{try{action();}catch{/* A detached/loading player must not prevent cleanup. */}};
    const currentVideo=document.querySelector<HTMLVideoElement>("#movie_player video");
    if(!restorePlayback||location.href===initialUrl){
      attempt(()=>video.pause());
      if(currentVideo&&currentVideo!==video)attempt(()=>currentVideo.pause());
    }
    if(restorePlayback&&location.href===initialUrl){
      const restored=currentVideo??video;
      restored.muted=playback.muted;restored.volume=playback.volume;restored.playbackRate=playback.rate;
      const player=document.getElementById("movie_player") as HTMLElement&{seekTo?:(time:number,allowSeekAhead:boolean)=>void;mute?:()=>void;unMute?:()=>void}|null;
      try{if(player?.seekTo)player.seekTo(playback.time,true);else restored.currentTime=playback.time;}catch{/* Navigation/loading may prevent seeking. */}
      attempt(()=>{if(playback.muted)player?.mute?.();else player?.unMute?.();});
      if(!playback.paused)attempt(()=>{void restored.play().catch(()=>{});});
    }
  }
}
