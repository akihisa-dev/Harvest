import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {streamSite} from './support/stream-site.mjs';
import {readCompletedDownload} from './support/animation-panel.mjs';

test('遅い録画の実転送量を保存ボタンへ反映し、Chromeの完了後に成功にする', {timeout:60000},async t=>{
 const fixture=await streamSite(t,{chunkIntervalMs:100}),panel=fixture.panel;
 await fixture.scan('stream');await panel.locator('#video-export-format-mp4').check();
 await panel.evaluate(()=>{
  window.progressSamples=[];window.ownQueries=[];
  const search=chrome.downloads.search.bind(chrome.downloads);
  chrome.downloads.search=async query=>{window.ownQueries.push(query);return search(query);};
  new MutationObserver(()=>{
    const value=document.querySelector('#export').textContent;
    if(/^\d+%$/.test(value))window.progressSamples.push(Number(value.slice(0,-1)));
  }).observe(document.querySelector('#export'),{subtree:true,childList:true,characterData:true});
 });
 await panel.locator('#export').click();
 await panel.waitForFunction(()=>window.progressSamples.some(value=>value>0&&value<90));
 assert.equal(await panel.locator('#status').getAttribute('data-state'),'busy');
 await panel.waitForFunction(()=>document.querySelector('#status').dataset.state==='success');
 const result=await panel.evaluate(async()=>({samples:window.progressSamples,queries:window.ownQueries,ids:window.downloadIds,item:(await chrome.downloads.search({id:window.downloadIds.at(-1)}))[0]}));
 assert.ok(new Set(result.samples).size>=3);assert.ok(result.samples.every(value=>value<100));
 assert.ok(result.samples.every((value,index)=>index===0||value>=result.samples[index-1]));
 assert.ok(result.queries.every(query=>Object.keys(query).join()==='id'&&result.ids.includes(query.id)));
 assert.equal(result.item.state,'complete');
 const saved=await readCompletedDownload(result.item.filename);
 assert.equal(createHash('sha256').update(saved).digest('hex'),createHash('sha256').update(fixture.recording).digest('hex'));
 const before=await panel.evaluate(()=>window.ownQueries.length);
 await panel.waitForTimeout(600);
 assert.equal(await panel.evaluate(()=>window.ownQueries.length),before,'保存完了後に進捗照会を残さない');
});
