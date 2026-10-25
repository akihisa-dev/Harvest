import assert from 'node:assert/strict';
import test from 'node:test';
import {youtubeVideoId,youtubeStreamingUrl,selectYoutubeFormats} from '../dist/extension/core/youtube.js';
import {ImageCollection} from '../dist/extension/core/image-collection.js';
import {collectPageMedia} from '../dist/extension/core/page-media.js';
import {isPageScan} from '../dist/extension/app/contracts/page-contracts.js';
import {fetchVideoSize} from '../dist/extension/app/media/video-size.js';
import {YoutubeSabrSession} from '../dist/extension/core/youtube-sabr.js';
import {readWire,wireBytes,wireNumber,readUmp,replaceWire} from '../dist/extension/core/youtube-wire.js';
import {videoId,url,video,audio,template,b,n,t,join,part,initialization,segment,header,completeResponse} from './support/youtube-fixture.mjs';

test('YouTubeの単一動画だけを識別し、偽ホスト・資格情報・配信先の差し替えを拒否する',()=>{
  for(const address of [`https://www.youtube.com/watch?v=${videoId}&list=playlist&t=12`,`https://youtu.be/${videoId}?si=abc`,`https://m.youtube.com/shorts/${videoId}`,`https://youtube.com/embed/${videoId}`])assert.equal(youtubeVideoId(address),videoId);
  for(const address of ['https://www.youtube.com/playlist?list=abc',`https://youtube.com.attacker.test/watch?v=${videoId}`,`https://user:secret@youtube.com/watch?v=${videoId}`,'https://youtu.be/too-short'])assert.equal(youtubeVideoId(address),null);
  assert.equal(youtubeStreamingUrl(url),url);
  for(const address of ['http://r1.googlevideo.com/videoplayback','https://googlevideo.com.attacker.test/videoplayback','https://127.0.0.1/videoplayback','https://r1.googlevideo.com:8443/videoplayback','https://r1.googlevideo.com/other'])assert.throws(()=>youtubeStreamingUrl(address));
});

test('画質・フレームレートと既定音声を優先し、容量に合わせた画質低下や吹替の勝手な選択をしない',()=>{
  const higher={...video,itag:299,fps:60};
  assert.equal(selectYoutubeFormats([video,higher,audio,{...audio,itag:999,bitrate:99999,defaultAudio:false}]).video,higher);
  assert.equal(selectYoutubeFormats([video,audio]).audio,audio);
  assert.throws(()=>selectYoutubeFormats([video,{...audio,defaultAudio:false}]),/映像・音声/);
  assert.throws(()=>new YoutubeSabrSession(videoId,url,template,video,audio,10),/容量/);
});

test('YouTubeの識別情報は解析から選択・保存まで維持し、サイズ調査で視聴ページを取得しない',async()=>{
  const pageUrl=`https://www.youtube.com/watch?v=${videoId}`,youtube={videoId,quality:'1080p',bytes:16};
  const scan={url:pageUrl,title:'video',images:[],media:[{url:pageUrl,kind:'video',youtube}]};
  assert.equal(isPageScan(scan),true);
  assert.equal(isPageScan({...scan,media:[{url:pageUrl,kind:'image',youtube}]}),false);
  const collected=collectPageMedia(scan),collection=new ImageCollection();
  collection.replace(collected.urls,scan.url,collected.media);
  assert.deepEqual(collection.selectedItems[0].youtube,youtube);
  assert.equal(await fetchVideoSize(collection.selectedItems[0]),16);
});

test('映像・音声の全区間と終端がそろうまで、完成した出力を返さない',()=>{
  const s=new YoutubeSabrSession(videoId,url,template,video,audio,1024);
  assert.equal(s.complete,false);assert.throws(()=>s.output());
  s.ingest(completeResponse());assert.equal(s.complete,true);assert.equal(s.progressMs,2000);
  assert.deepEqual([...s.output().video],[0,2,1,2,2,2]);
  assert.deepEqual([...s.output().audio],[0,2,1,2,2,2]);
  const request=readWire(s.request(1000));assert.equal(wireNumber(readWire(wireBytes(request,1)),28),2000);
  assert.deepEqual([...wireBytes(readWire(wireBytes(request,19)),2)],new Array(32).fill(7));
});

test('応答をまたぐ断片と同一再送を処理し、欠落・別動画・違う画質・破損を拒否する',()=>{
  const create=()=>new YoutubeSabrSession(videoId,url,template,video,audio,1024);
  const s=create();s.ingest(initialization(video));s.ingest(initialization(audio));
  const data=new Uint8Array([0,2]);s.ingest(join([header(video,1,0,data),part(21,new Uint8Array([1,0]))]));
  assert.equal(s.complete,false);s.ingest(join([part(21,new Uint8Array([1,2])),part(22,new Uint8Array([1]))]));
  s.ingest(segment(video,2,0));assert.equal(s.downloadedBytes,2);
  s.ingest(join([segment(video,1,2),segment(audio,2,0),segment(audio,2,1),segment(audio,2,2)]));
  assert.equal(s.complete,false);assert.equal(s.progressMs,0);assert.throws(()=>s.output());
  const ranges=readWire(s.request(0)).filter(field=>field.id===3).map(field=>readWire(field.value));
  assert.equal(ranges.length,1,'先頭区間が未着の映像範囲は送信しない');
  assert.equal(wireNumber(readWire(wireBytes(ranges[0],1)),1),audio.itag);
  assert.equal(wireNumber(ranges[0],4),1);assert.equal(wireNumber(ranges[0],5),2);
  s.ingest(segment(video,1,1));assert.equal(s.complete,true);
  assert.equal(readWire(s.request(0)).filter(field=>field.id===3).length,2);
  assert.throws(()=>s.ingest(segment(video,1,1,new Uint8Array([9,9]))),/不完全/);
  assert.throws(()=>create().ingest(part(42,join([t(1,'other-video'),b(2,new Uint8Array())]))),/不完全/);
  assert.throws(()=>create().ingest(segment({...video,itag:999},1,0)),/画質/);
  assert.throws(()=>create().ingest(join([header(video,1,0,data),part(21,new Uint8Array([1,0])),part(22,new Uint8Array([1]))])),/不完全/);
});

test('認証更新と配信先変更を限定し、非公開の情報をエラー文字列へ含めない',()=>{
  const create=()=>new YoutubeSabrSession(videoId,url,template,video,audio,1024);
  assert.throws(()=>create().ingest(part(58,n(1,3))),/認証/);
  assert.throws(()=>create().ingest(part(43,t(1,'https://attacker.test/videoplayback'))),/配信先/);
  const s=create();s.ingest(part(43,t(1,'https://r2-test.googlevideo.com/videoplayback?sabr=1')));
  assert.equal(new URL(s.url).hostname,'r2-test.googlevideo.com');
  const cold=join([b(5,new Uint8Array([1])),b(19,join([b(1,n(16,1)),b(2,new Uint8Array(10))]))]);
  assert.throws(()=>new YoutubeSabrSession(videoId,url,cold,video,audio,1024),/認証/);
});

test('ネットワークの切断・不正な長さ・整数の桁あふれを処理前に拒否する',()=>{
  const bytes=completeResponse();assert.throws(()=>[...readUmp(bytes.subarray(0,-1),1024)],/不完全/);
  assert.throws(()=>readWire(new Uint8Array([10,255,127])),/不完全/);
  assert.throws(()=>readWire(new Uint8Array([8,...new Array(11).fill(255)])),/不完全/);
  assert.throws(()=>[...readUmp(part(21,new Uint8Array(128)),64)],/不完全/);
});

test('サーバーの認証状態・再取得指示と通信状態更新を区別する',()=>{
  const s=new YoutubeSabrSession(videoId,url,template,video,audio,1024);
  s.ingest(part(58,n(1,2))); // Pending is not the same as a rejection.
  s.ingest(part(51,new Uint8Array())); // Format availability is not an error.
  s.ingest(part(57,join([n(1,7),b(3,new Uint8Array([1])),n(4,1),n(5,1)])));
  s.ingest(part(57,join([n(1,7),b(3,new Uint8Array([2])),n(4,1),n(5,2)])));
  const context=readWire(wireBytes(readWire(s.request(0)),19));
  assert.deepEqual([...wireBytes(readWire(wireBytes(context,5)),2)],[1]);
  s.ingest(part(57,join([n(1,7),b(3,new Uint8Array([2])),n(4,1),n(5,1)])));
  assert.deepEqual([...wireBytes(readWire(wireBytes(readWire(wireBytes(readWire(s.request(0)),19)),5)),2)],[2]);
  assert.throws(()=>s.ingest(part(46,new Uint8Array())),/認証/);
});

test('公開SABR定義の両トラック要求は0で、元の片トラック設定も上書きする',()=>{
  // Independent protocol oracle: GoogleVideo formatUtils.ts EnabledTrackTypes, VIDEO_AND_AUDIO=0.
  const original=replaceWire(template,new Map([[1,[b(1,join([n(28,0),n(40,2)]))]]]));
  const s=new YoutubeSabrSession(videoId,url,original,video,audio,1024);
  assert.equal(wireNumber(readWire(wireBytes(readWire(s.request(0)),1)),40),0);
});

test('有効な断片を受け取るたびに進捗が増え、完成済み容量と区別する',()=>{
  const s=new YoutubeSabrSession(videoId,url,template,video,audio,1024);
  const data=new Uint8Array(12).fill(7);
  s.ingest(segment(video,0,0));s.ingest(header(video,1,1,data));
  for(let i=0;i<12;i++){
    const before=s.receivedBytes;s.ingest(part(21,new Uint8Array([1,data[i]])));
    assert.equal(s.receivedBytes,before+1);assert.equal(s.downloadedBytes,2);
  }
  s.ingest(part(22,new Uint8Array([1])));
  assert.equal(s.receivedBytes,14);assert.equal(s.downloadedBytes,14);
  s.ingest(segment(video,2,1,data));assert.equal(s.receivedBytes,14,'完全に受信済みの再送は新しい進捗にしない');
});

test('初回要求で取得済みcookie・送信済み状態・未送信状態と未知の状態項目を保持する',()=>{
  const seed=join([n(1,9),b(2,new Uint8Array([4,5])),t(99,'opaque-fixture')]);
  const cookie=new Uint8Array([8,16,32]);
  const context=join([b(1,n(16,1)),b(2,new Uint8Array(32)),b(3,cookie),b(5,seed),n(6,33),b(6,new Uint8Array([44,45]))]);
  const original=replaceWire(template,new Map([[19,[b(19,context)]]]));
  const s=new YoutubeSabrSession(videoId,url,original,video,audio,1024);
  const state=()=>readWire(wireBytes(readWire(s.request(0)),19));
  assert.deepEqual([...wireBytes(state(),3)],[...cookie]);assert.deepEqual([...wireBytes(state(),5)],[...seed]);
  assert.deepEqual(state().filter(f=>f.id===6).map(f=>Number(f.value)),[33,44,45]);
  s.ingest(part(35,n(4,1)));assert.deepEqual([...wireBytes(state(),3)],[...cookie],'cookie未指定の更新では既存状態を消さない');
  s.ingest(part(57,join([n(1,9),b(3,new Uint8Array([6])),n(5,2)])));
  assert.deepEqual([...wireBytes(state(),5)],[...seed],'KEEP_EXISTINGは元の未知項目も保持する');
  s.ingest(part(57,join([n(1,9),b(3,new Uint8Array([6])),n(5,1)])));
  assert.deepEqual([...wireBytes(readWire(wireBytes(state(),5)),2)],[6]);
  s.ingest(part(59,join([b(2,new Uint8Array([9])),b(3,new Uint8Array([33]))])));
  assert.equal(wireBytes(state(),5),undefined);assert.deepEqual(state().filter(f=>f.id===6).map(f=>Number(f.value)),[44,45,9]);
});

test('MP3用取得は大きな映像を要求せず、音声の末尾・容量・再試行状態を検査する',()=>{
  const huge={...video,contentLength:108*1024*1024};
  assert.throws(()=>new YoutubeSabrSession(videoId,url,template,huge,audio,1024),/容量/);
  const s=new YoutubeSabrSession(videoId,url,template,huge,audio,1024,true);
  s.ingest(initialization(audio));s.ingest(segment(audio,1,0));s.ingest(segment(audio,1,1));
  assert.equal(s.complete,false);assert.throws(()=>s.output(),/不完全/);
  const request=readWire(s.request(1));
  assert.equal(wireNumber(readWire(wireBytes(request,1)),40),1);
  assert.equal(wireBytes(request,17),undefined);
  assert.equal(wireNumber(readWire(wireBytes(readWire(wireBytes(request,3)),1)),1),audio.itag);
  s.ingest(segment(audio,1,2));assert.equal(s.complete,true);assert.equal(s.progressMs,2000);
  assert.equal(s.output().video.length,0);assert.equal(s.output().audio.length,6);
  assert.throws(()=>new YoutubeSabrSession(videoId,url,template,huge,{...audio,contentLength:1025},1024,true),/容量/);
  const bounded=new YoutubeSabrSession(videoId,url,template,huge,{...audio,contentLength:0},128,true);
  bounded.ingest(initialization(audio));bounded.ingest(segment(audio,1,0));bounded.ingest(segment(audio,1,1,new Uint8Array(100)));
  assert.throws(()=>bounded.ingest(segment(audio,1,2,new Uint8Array(100))),/容量/);
});
