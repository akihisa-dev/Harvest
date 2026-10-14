import test from 'node:test';
import assert from 'node:assert/strict';
import {scanYoutube,acquireYoutubeEvidence} from '../dist/extension/app/browser/youtube-page-access.js';
import {readYoutubePage} from '../dist/extension/app/content/youtube-page.js';
import {scanTab,scanUrl} from '../dist/extension/app/browser/page-access.js';
import {videoId,video,audio,template,url} from './support/youtube-fixture.mjs';

function events(){const listeners=new Set();return {listeners,addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)};}
function chromeFixture(t,behavior){
  const previous=globalThis.chrome,removed=[],onRemoved=events(),onUpdated=events();
  const address=`https://www.youtube.com/watch?v=${videoId}`;
  globalThis.chrome={windows:{create:async()=>{throw new Error('Must not open a window');}},tabs:{
    query:async()=>[{id:8,url:'https://www.youtube.com/',active:true}],create:async()=>{throw new Error('Must not open a tab');},remove:async()=>{throw new Error('Must not close a tab');},onRemoved,onUpdated,get:async()=>({status:'complete',url:address})},
    scripting:{executeScript:async request=>{
      if(request.func.name==='manageYoutubeFrame'){if(request.args[2])removed.push(request.target.tabId);return [{documentId:'host',result:address}];}
      if(request.target.documentIds)return [{documentId:request.target.documentIds[0],result:true}];
      const rows=await behavior(request);
      if(request.target.tabId===8&&!request.target.allFrames)return rows.map(row=>({...row,documentId:['doc','temporary'].includes(row.documentId)?'host':row.documentId}));
      return rows;
    }}};
  t.after(()=>{if(previous===undefined)delete globalThis.chrome;else globalThis.chrome=previous;});
  return {removed,onRemoved,onUpdated,address};
}
for(const outcome of ['success','navigation','closed','abort'])test(`開いている対象動画の解析はフレームを追加せず再生情報だけを読む: ${outcome}`,async t=>{
  const controller=new AbortController();let fixture,reads=0;
  fixture=chromeFixture(t,async request=>{
    assert.notEqual(request.func.name,'manageYoutubeFrame');assert.equal(request.target.allFrames,undefined);reads++;
    if(request.func.name==='readYoutubePage'){
      assert.deepEqual(request.args,[videoId,false]);
      if(outcome==='abort'){controller.abort();return new Promise(()=>{});}
      if(outcome==='closed'){for(const listener of fixture.onRemoved.listeners)listener(8);return new Promise(()=>{});}
      return [{documentId:'doc',result:{videoId,title:'open video',previewUrl:'',formats:[video,audio]}}];
    }
    return [{documentId:outcome==='navigation'?'new':'doc',result:fixture.address}];
  });
  chrome.tabs.query=async()=>[{id:8,url:fixture.address}];
  if(outcome==='success'){assert.equal((await scanYoutube(videoId,controller.signal)).title,'open video');assert.equal(reads,2);}
  else await assert.rejects(scanYoutube(videoId,controller.signal),/移動|閉じ|終了/);
  assert.deepEqual(fixture.removed,[]);assert.equal(fixture.onRemoved.listeners.size,0);
});
test('同じ動画が複数タブにある場合、解析はアクティブな視聴ページを優先する',async t=>{
  let fixture;
  fixture=chromeFixture(t,async request=>{
    assert.equal(request.target.tabId,33);assert.notEqual(request.func.name,'manageYoutubeFrame');
    return [{documentId:'active',result:request.func.name==='readYoutubePage'?{videoId,title:'active video',previewUrl:'',formats:[video,audio]}:fixture.address}];
  });
  chrome.tabs.query=async()=>[{id:8,url:fixture.address,active:false},{id:33,url:fixture.address,active:true}];
  assert.equal((await scanYoutube(videoId)).title,'active video');assert.deepEqual(fixture.removed,[]);
});
for(const outcome of ['create-abort','frame-timeout','create-failure'])test(`取得フレームの準備失敗で既存タブを残し、自分のフレームだけを解放する: ${outcome}`,async t=>{
  const controller=new AbortController(),fixture=chromeFixture(t,async()=>[]);
  let created;
  const execute=chrome.scripting.executeScript;
  chrome.scripting.executeScript=async request=>{
    if(request.func.name==='manageYoutubeFrame'&&!request.args[2]){
      if(outcome==='create-failure')throw new Error('YouTubeの動画情報を確認できませんでした。');
      if(outcome==='create-abort')await new Promise(resolve=>{created=resolve;});
    }
    return execute(request);
  };
  if(outcome==='frame-timeout')t.mock.timers.enable({apis:['setTimeout']});
  const work=acquireYoutubeEvidence(videoId,true,controller.signal);
  const rejected=assert.rejects(work,/終了|時間切れ|確認/);
  for(let i=0;i<10;i++)await Promise.resolve();
  if(outcome==='create-abort'){controller.abort();created();}
  if(outcome==='frame-timeout')t.mock.timers.tick(90000);
  await rejected;
  assert.deepEqual(fixture.removed,outcome==='create-failure'?[]:[8]);assert.equal(fixture.onRemoved.listeners.size,0);assert.equal(fixture.onUpdated.listeners.size,0);
});
for(const requested of [false,true])for(const outcome of ['success','navigation','reload','closed'])test(`現在のYouTubeタブの文書を解析前後に確認する: requested=${requested}, ${outcome}`,async t=>{
  let fixture,finished=false,sourceReads=0;
  fixture=chromeFixture(t,async ({target,func})=>{
    if(target.tabId===9){
      sourceReads++;
      return [{documentId:finished&&outcome==='reload'?'reloaded':'source',result:func.name==='scanDocument'?{url:fixture.address,title:'source',images:[]}:finished&&outcome==='navigation'?'https://example.com/':fixture.address}];
    }
    if(func.name==='readYoutubePage'){finished=true;return [{documentId:'temporary',result:{videoId,title:'video',previewUrl:'',formats:[video,audio]}}];}
    return [{documentId:'temporary',result:fixture.address}];
  });
  chrome.tabs.get=async id=>{if(id===9&&finished&&outcome==='closed')throw new Error('closed');return {status:'complete',url:fixture.address};};
  const operation=scanTab(9,undefined,requested?fixture.address:undefined);
  if(outcome==='success'){assert.equal((await operation).media[0].youtube.videoId,videoId);assert.equal(sourceReads,2);}
  else await assert.rejects(operation,/移動|閉じ/);
  assert.deepEqual(fixture.removed,[8]);assert.equal(fixture.onRemoved.listeners.size,0);
});
test('入力URLからのYouTube解析も既存タブを使い、新しいタブを作らない',async t=>{
  let fixture;
  fixture=chromeFixture(t,async ({func})=>func.name==='readYoutubePage'?[{documentId:'temporary',result:{videoId,title:'video',previewUrl:'',formats:[video,audio]}}]:[{documentId:'temporary',result:fixture.address}]);
  assert.equal((await scanUrl(fixture.address)).media[0].youtube.videoId,videoId);
  assert.deepEqual(fixture.removed,[8]);
});
for(const outcome of ['success','shape','navigation','closed','abort'])test(`YouTubeの取得フレームを解析・中止・異常終了後に解放する: ${outcome}`,async t=>{
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
  assert.deepEqual(fixture.removed,[8]);assert.equal(fixture.onRemoved.listeners.size,0);assert.equal(fixture.onUpdated.listeners.size,0);
});

for(const bodyKind of ['buffer','blob','request'])test(`先読み済みでも監視後の再読み込みから認証を読み取り、元要求を維持する: ${bodyKind}`,async t=>{
  const previous={location:globalThis.location,document:globalThis.document,window:globalThis.window,XMLHttpRequest:globalThis.XMLHttpRequest};
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const address=`https://www.youtube.com/watch?v=${videoId}`;
  globalThis.location={origin:'https://www.youtube.com',pathname:'/watch',href:address};
  let sent=0,paused=0;
  class Request {open(){}send(){sent++;}}
  let fetchedRequest;
  const originalOpen=Request.prototype.open,originalSend=Request.prototype.send,originalFetch=input=>{fetchedRequest=input;sent++;return Promise.resolve({});};
  globalThis.XMLHttpRequest=Request;globalThis.window={fetch:originalFetch};
  const native=f=>({itag:f.itag,lastModified:f.lastModified,mimeType:f.mimeType,approxDurationMs:String(f.durationMs),height:f.height,fps:f.fps,bitrate:f.bitrate,contentLength:String(f.contentLength),...(f.defaultAudio?{audioTrack:{id:f.language,audioIsDefault:true}}:{})});
  const response={videoDetails:{videoId,title:'fixture',thumbnail:{thumbnails:[{url:`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}]}},playabilityStatus:{status:'OK'},streamingData:{adaptiveFormats:[native(video),native(audio)]}};
  let reloaded=0,muted=0;
  const player={getPlayerResponse:()=>response,mute(){muted++;},loadVideoById(id,start){
    assert.equal(id,videoId);assert.equal(start,0);assert.equal(muted,1);reloaded++;
    if(bodyKind==='request'){void window.fetch(new globalThis.Request(url,{method:'POST',body:template}));}
    else {const request=new Request();request.open('POST',url);request.send(bodyKind==='blob'?new Blob([template]):template);}
  }},element={muted:false,play(){throw new Error('Buffered playback should not be relied upon');},pause(){paused++;}};
  globalThis.document={title:'fixture',getElementById:()=>player,querySelector:()=>element};
  const result=await readYoutubePage(videoId,true);
  assert.equal(reloaded,1);assert.equal(muted,1);
  if(fetchedRequest){assert.equal(fetchedRequest.bodyUsed,false);assert.deepEqual([...new Uint8Array(await fetchedRequest.arrayBuffer())],[...template]);}
  assert.equal(result.capture.url,url);assert.deepEqual(result.capture.body,[...template]);assert.equal(sent,1);assert.equal(paused,1);
  assert.equal(Request.prototype.open,originalOpen);assert.equal(Request.prototype.send,originalSend);assert.equal(window.fetch,originalFetch);
  assert.equal(result.previewUrl,`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  response.videoDetails.isLive=true;
  assert.match((await readYoutubePage(videoId,true)).error,/ライブ/);assert.equal(sent,1);
});
