import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {chromium} from 'playwright';
import {mp4Bytes} from './media-fixtures.mjs';

test('sourceの交換・削除・属性変更の非同期currentSrcを更新し、共有参照と追加sourceを保持する', async () => {
  const source = await readFile(new URL('../dist/extension/app/page-scan.js',import.meta.url),'utf8');
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage();
    await page.route('https://scan.test/**', async route => {
      if (route.request().url().endsWith('.mp4')) {
        if (route.request().url().endsWith('new.mp4')) await new Promise(resolve => setTimeout(resolve,100));
        return route.fulfill({contentType:'video/mp4',body:mp4Bytes});
      }
      return route.fulfill({contentType:'text/html',body:'<html><body><main></main></body></html>'});
    });
    for (const mode of ['replace','remove','attribute','shared','append','add-empty','remove-shared']) {
      await page.goto('https://scan.test/');
      const observed = await page.evaluate(async ({source,mode}) => {
        const moduleUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
        const {scanDocument}=await import(moduleUrl);URL.revokeObjectURL(moduleUrl);
        const main=document.querySelector('main');
        const video=document.createElement('video');
        const old=document.createElement('source');old.src='/old.mp4';old.type='video/mp4';if(mode!=='add-empty')video.append(old);main.append(video);
        const ready = element => new Promise((resolve,reject)=>{element.addEventListener('loadedmetadata',resolve,{once:true});element.addEventListener('error',reject,{once:true});element.load();});
        if(mode!=='add-empty')await ready(video);
        if(mode==='shared'||mode==='remove-shared') {const shared=document.createElement('video');shared.src='/old.mp4';main.append(shared);await ready(shared);}
        const initial=video.currentSrc;
        const scan=scanDocument();
        let currentAfterChange;
        const change = new Promise(resolve=>setTimeout(async()=> {
          const next=document.createElement('source');next.src='/new.mp4';next.type='video/mp4';
          if(mode==='attribute')old.src=next.src;
          else if(mode==='remove'||mode==='remove-shared')old.remove();
          else if(mode==='append'||mode==='add-empty')video.append(next);
          else old.replaceWith(next);
          video.load();
          currentAfterChange=video.currentSrc;
          if(mode!=='remove'&&mode!=='remove-shared') await new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));
          resolve();
        },40));
        const result=await scan;
        const atScan=video.currentSrc;
        await change;
        return {initial,currentAfterChange,atScan,final:video.currentSrc,networkState:video.networkState,urls:(result.media??[]).map(item=>item.url)};
      },{source,mode});
      assert.equal(observed.initial,mode==='add-empty'?'':'https://scan.test/old.mp4',mode);
      const expected=mode==='remove'?[]:mode==='remove-shared'?['https://scan.test/old.mp4']:mode==='shared'||mode==='append'?['https://scan.test/old.mp4','https://scan.test/new.mp4']:['https://scan.test/new.mp4'];
      if(mode==='remove'||mode==='remove-shared')assert.equal(observed.networkState,0,mode+' must empty the media element');
      else assert.equal(observed.final,mode==='append'?'https://scan.test/old.mp4':'https://scan.test/new.mp4',mode);
      assert.equal(observed.atScan,observed.final,'currentSrc must update within observation window: '+mode);
      assert.deepEqual([...observed.urls].sort(),expected.sort(),JSON.stringify({mode,...observed}));
    }
  } finally {await browser.close();}
});
