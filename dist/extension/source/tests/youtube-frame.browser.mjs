import assert from 'node:assert/strict';
import test from 'node:test';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {temporaryDirectory,launchExtensionContext} from './support/browser.mjs';
import {videoId,video,audio,template,url} from './support/youtube-fixture.mjs';

for(const host of ['https://www.youtube.com/watch?v=2FF0Wc6ckQY&t=14s','https://example.test/gallery'])test(`既存ページの再生・タブを保ち、非表示フレームで認証を取得して解放する: ${host}`,{timeout:30000},async t=>{
  const temporary=await temporaryDirectory(t,join(tmpdir(),'harvest-youtube-frame-'));
  const context=await launchExtensionContext(t,join(temporary,'profile'));
  const cdp=await context.browser().newBrowserCDPSession();
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:resolve(process.env.HARVEST_TEST_EXTENSION_DIR??'dist/extension')});
  await cdp.detach();
  const native=f=>({itag:f.itag,lastModified:f.lastModified,mimeType:f.mimeType,contentLength:String(f.contentLength),approxDurationMs:String(f.durationMs),height:f.height,fps:f.fps,bitrate:f.bitrate,...(f.defaultAudio?{audioTrack:{id:f.language,audioIsDefault:true}}:{})});
  const response={videoDetails:{videoId,title:'fixture'},playabilityStatus:{status:'OK'},streamingData:{adaptiveFormats:[native(video),native(audio)]}};
  await context.route('https://www.youtube.com/**',route=>{
    if(!route.request().frame().parentFrame())return route.fulfill({contentType:'text/html',body:'<div id="movie_player"><video></video></div><script>window.playerCalls=0;const player=document.getElementById("movie_player");player.mute=player.loadVideoById=()=>{window.playerCalls++;throw Error("Must not alter host player");};</script>'});
    return route.fulfill({contentType:'text/html',headers:{'x-frame-options':'SAMEORIGIN'},body:`<div id="movie_player"><video></video></div><script>
      const player=document.getElementById('movie_player');
      player.getPlayerResponse=()=>(${JSON.stringify(response)});
      player.mute=()=>{document.querySelector('video').muted=true;};
      player.loadVideoById=()=>{const request=new XMLHttpRequest();request.open('POST',${JSON.stringify(url)});request.send(new Uint8Array(${JSON.stringify([...template])}));};
    </script>`});
  });
  // The cross-origin fallback uses YouTube's embeddable player, which permits frames.
  await context.route('https://www.youtube.com/embed/**',route=>route.fulfill({contentType:'text/html',body:`<div id="movie_player"><video></video></div><script>
    const player=document.getElementById('movie_player');player.getPlayerResponse=()=>(${JSON.stringify(response)});player.mute=()=>{document.querySelector('video').muted=true;};
    player.loadVideoById=()=>{const request=new XMLHttpRequest();request.open('POST',${JSON.stringify(url)});request.send(new Uint8Array(${JSON.stringify([...template])}));};
  </script>`}));
  await context.route('https://example.test/**',route=>route.fulfill({contentType:'text/html',body:'<main>existing page</main>'}));
  await context.route('https://*.googlevideo.com/**',route=>route.fulfill({contentType:'application/vnd.yt-ump',body:Buffer.alloc(0)}));
  const page=await context.newPage();await page.goto(host);
  const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/app/index.html`);
  const pages=context.pages(),beforeUrl=page.url();let opened=0;context.on('page',()=>opened++);
  const result=await panel.evaluate(async videoId=>{
    const {acquireYoutubeEvidence}=await import(chrome.runtime.getURL('app/browser/youtube-page-access.js'));
    const before=await chrome.tabs.query({});
    const evidence=await acquireYoutubeEvidence(videoId,true);
    const after=await chrome.tabs.query({});
    return {evidence,before:before.map(t=>t.id),after:after.map(t=>t.id)};
  },videoId);
  assert.equal(result.evidence.videoId,videoId);assert.deepEqual(result.evidence.capture.body,[...template]);
  assert.deepEqual(result.before,result.after);assert.equal(opened,0);assert.deepEqual(context.pages(),pages);assert.equal(page.url(),beforeUrl);
  assert.equal(await page.locator('iframe[id^="harvest-youtube-"]').count(),0);
  if(host.startsWith('https://www.youtube.com'))assert.equal(await page.evaluate(()=>window.playerCalls),0);
});
