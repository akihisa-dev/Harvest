import test from 'node:test';
import assert from 'node:assert/strict';
import {scanYoutube,acquireYoutubeEvidence} from '../dist/extension/app/browser/youtube-page-access.js';
import {readYoutubePage} from '../dist/extension/app/content/youtube-page.js';
import {videoId,video,audio,template,url} from './support/youtube-fixture.mjs';

function events(){const listeners=new Set();return {listeners,addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)};}
function chromeFixture(t,behavior){
  const previous=globalThis.chrome,removed=[],onRemoved=events(),onUpdated=events();
  const address=`https://www.youtube.com/watch?v=${videoId}`;
  globalThis.chrome={windows:{create:async()=>({id:7,tabs:[{id:8}]}),remove:async id=>removed.push(id)},tabs:{onRemoved,onUpdated,get:async()=>({status:'complete'})},scripting:{executeScript:behavior}};
  t.after(()=>{if(previous===undefined)delete globalThis.chrome;else globalThis.chrome=previous;});
  return {removed,onRemoved,onUpdated,address};
}
for(const outcome of ['success','shape','navigation','closed','abort'])test(`YouTubeの一時ページを解析・中止・異常終了後に解放する: ${outcome}`,async t=>{
  const controller=new AbortController();let fixture;
  fixture=chromeFixture(t,async request=>{
    if(request.func.name!=='readYoutubePage')return [{documentId:outcome==='navigation'?'changed':'doc',result:fixture.address}];
    if(outcome==='abort'){controller.abort();return new Promise(()=>{});}
    if(outcome==='closed'){for(const listener of fixture.onRemoved.listeners)listener(8);return new Promise(()=>{});}
    return [{documentId:'doc',result:outcome==='shape'?{formats:[{}]}:{videoId,title:'example',previewUrl:'',formats:[video,audio]}}];
  });
  if(outcome==='success'){
    const result=await scanYoutube(videoId,controller.signal);assert.equal(result.media[0].youtube.videoId,videoId);assert.equal(result.media[0].youtube.bytes,16);
    assert.equal('capture' in result.media[0],false);
  }else await assert.rejects(acquireYoutubeEvidence(videoId,true,controller.signal),/確認|移動|閉じ|終了/);
  assert.deepEqual(fixture.removed,[7]);assert.equal(fixture.onRemoved.listeners.size,0);assert.equal(fixture.onUpdated.listeners.size,0);
});

test('通常の再生通信を変えずに認証を読み取り、観測処理と再生を終了する',async t=>{
  const previous={location:globalThis.location,document:globalThis.document,window:globalThis.window,XMLHttpRequest:globalThis.XMLHttpRequest};
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const address=`https://www.youtube.com/watch?v=${videoId}`;
  globalThis.location={origin:'https://www.youtube.com',pathname:'/watch',href:address};
  let sent=0,paused=0;
  class Request {open(){}send(){sent++;}}
  const originalOpen=Request.prototype.open,originalSend=Request.prototype.send,originalFetch=()=>Promise.resolve({});
  globalThis.XMLHttpRequest=Request;globalThis.window={fetch:originalFetch};
  const native=f=>({itag:f.itag,lastModified:f.lastModified,mimeType:f.mimeType,approxDurationMs:String(f.durationMs),height:f.height,fps:f.fps,bitrate:f.bitrate,contentLength:String(f.contentLength),...(f.defaultAudio?{audioTrack:{id:f.language,audioIsDefault:true}}:{})});
  const response={videoDetails:{videoId,title:'fixture',thumbnail:{thumbnails:[{url:`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}]}},playabilityStatus:{status:'OK'},streamingData:{adaptiveFormats:[native(video),native(audio)]}};
  const player={getPlayerResponse:()=>response},element={muted:false,play(){const request=new Request();request.open('POST',url);request.send(template);return Promise.resolve();},pause(){paused++;}};
  globalThis.document={title:'fixture',getElementById:()=>player,querySelector:()=>element};
  const result=await readYoutubePage(videoId,true);
  assert.equal(result.capture.url,url);assert.deepEqual(result.capture.body,[...template]);assert.equal(sent,1);assert.equal(paused,1);
  assert.equal(Request.prototype.open,originalOpen);assert.equal(Request.prototype.send,originalSend);assert.equal(window.fetch,originalFetch);
  assert.equal(result.previewUrl,`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  response.videoDetails.isLive=true;
  assert.match((await readYoutubePage(videoId,true)).error,/ライブ/);assert.equal(sent,1);
});
