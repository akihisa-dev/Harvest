import assert from 'node:assert/strict';
import test from 'node:test';
import {streamSite} from './support/stream-site.mjs';
import {animationPanel,readCompletedDownload} from './support/animation-panel.mjs';
import {mediaFixturePage} from './support/media-fixture-page.mjs';

for(const type of ['video/mp4','application/octet-stream'])test(`録画の実通信応答をMP3と画像混在ZIPへ渡す: ${type}`,{timeout:90000},async t=>{
 const {page}=await animationPanel(t,new Map());
 const generator=await mediaFixturePage(t,page);
 const bytes=await generator.evaluate(async()=>{
  const {Output,Mp4OutputFormat,BufferTarget,CanvasSource,AudioBufferSource}=await import('/mediabunny.js');
  const canvas=new OffscreenCanvas(32,24);canvas.getContext('2d').fillRect(0,0,32,24);
  const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target});
  const video=new CanvasSource(canvas,{codec:'avc',bitrate:100000}),audio=new AudioBufferSource({codec:'aac',bitrate:64000});
  output.addVideoTrack(video,{frameRate:10});output.addAudioTrack(audio);await output.start();
  const buffer=new AudioBuffer({length:19200,numberOfChannels:1,sampleRate:48000});
  const values=buffer.getChannelData(0);for(let i=0;i<values.length;i++)values[i]=.2*Math.sin(i*2*Math.PI*440/48000);
  await Promise.all([(async()=>{for(let i=0;i<4;i++)await video.add(i/10,.1);video.close();})(),(async()=>{await audio.add(buffer);audio.close();})()]);
  await output.finalize();return [...new Uint8Array(target.buffer)];
 });
 const fixture=await streamSite(t,{recording:Buffer.from(bytes),contentType:type,includeImage:true}),panel=fixture.panel;
 await fixture.scan('stream');await panel.locator('#video-export-format-mp3').check();await panel.locator('#export').click();
 await panel.waitForFunction(()=>document.querySelector('#status').dataset.state==='success');
 const read=async()=>{const item=await panel.evaluate(async()=>(await chrome.downloads.search({id:window.downloadIds.at(-1)}))[0]);return {item,bytes:await readCompletedDownload(item.filename)};};
 const mp3=await read();assert.match(mp3.item.filename,/\.mp3$/);
 const audio=await generator.evaluate(async data=>{
  const {Input,BlobSource,ALL_FORMATS}=await import('/mediabunny.js');const input=new Input({formats:ALL_FORMATS,source:new BlobSource(new Blob([new Uint8Array(data)]))});
  try{const track=await input.getPrimaryAudioTrack();return {codec:await track.getCodec(),duration:await track.computeDuration()};}finally{input.dispose();}
 },[...mp3.bytes]);
 assert.equal(audio.codec,'mp3');assert.ok(audio.duration>0);
 await fixture.scan('iframe');await panel.locator('#all-visibility').click();await panel.locator('#all-selection').check();assert.equal(await panel.locator('#images > li').count(),2);
 await panel.locator('#export-format-original').check();await panel.locator('#video-export-format-mp4').check();
 const anticipated=await panel.locator('#source-drop').textContent();assert.match(anticipated,/\.zip$/);await panel.locator('#export').click();
 await panel.waitForFunction(()=>document.querySelector('#status').dataset.state==='success');
 const zip=await read();assert.match(zip.item.filename,/\.zip$/);assert.ok(zip.item.filename.endsWith('/'+anticipated));
 const entries=[];let at=0;
 while(zip.bytes.readUInt32LE(at)===0x04034b50){const size=zip.bytes.readUInt32LE(at+22),start=at+30+zip.bytes.readUInt16LE(at+26);entries.push(zip.bytes.subarray(start,start+size));at=start+size;}
 assert.equal(entries.length,2);assert.ok(entries.some(entry=>entry.equals(Buffer.from(bytes))));
 assert.ok(fixture.requests.filter(r=>r.path.endsWith('/download.aspx')).every(r=>r.authenticated));
});
