import assert from 'node:assert/strict';
import test from 'node:test';
import {fetchOriginalMedia} from '../dist/extension/app/media/media-fetch.js';
import {streamDownloadUrl} from '../dist/extension/core/stream-recording.js';
import {mp4Bytes} from './media-fixtures.mjs';
const pageUrl='https://contoso.sharepoint.com/sites/team/_layouts/15/stream.aspx?id='+encodeURIComponent('/sites/team/Documents/meeting.mp4');
const url=streamDownloadUrl(pageUrl),stream={pageUrl};
for(const type of ['video/mp4','application/octet-stream'])test(`確認済み録画のGETをMP4本文検査へ渡す: ${type}`,async t=>{
 t.mock.method(globalThis,'fetch',async(target,options)=>{
  assert.equal(target,url);assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');
  return new Response(mp4Bytes,{headers:{'content-type':type,'content-disposition':'attachment; filename="meeting.mp4"'}});
 });
 const blob=await fetchOriginalMedia(url,'video',{sourcePage:pageUrl,stream});
 assert.equal(blob.type,'video/mp4');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),mp4Bytes);
});
for(const failure of ['missing-name','html','broken','mismatch','generic'])test(`録画の本文と識別子の拒否を維持する: ${failure}`,async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(failure==='html'?'<html>login</html>':failure==='broken'?mp4Bytes.subarray(0,-1):mp4Bytes,
  {headers:{'content-type':'application/octet-stream',...(failure==='missing-name'?{}:{'content-disposition':'attachment; filename="meeting.mp4"'})}});});
 await assert.rejects(fetchOriginalMedia(failure==='mismatch'?url+'&other=1':url,'video',{sourcePage:pageUrl,...(failure==='generic'?{}:{stream})}));
 if(failure==='mismatch')assert.equal(calls,0);
});
