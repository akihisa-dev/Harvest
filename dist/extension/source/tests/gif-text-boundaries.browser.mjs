import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {scanDocument} from '../dist/extension/app/content/page-scan.js';
import {normalizeImageUrls} from '../dist/extension/core/images.js';

for(const origin of ['body','json','attribute'])test(`GIF文字列のURL記号を保ち、切れた候補を加えない: ${origin}`,async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}):r.abort());
  const base='https://cdn.example.test/';
  const cases=[
   ['anim.gif?token=(abc)','anim.gif?token=(abc)'],['anim.gif?token=a,','anim.gif?token=a,'],
   ['anim.gif?token=a;','anim.gif?token=a;'],['anim.gif?token=a!','anim.gif?token=a!'],
   ['anim.gif?token=a?','anim.gif?token=a?'],['anim.gif#part=(abc)','anim.gif#part=(abc)'],
   ['anim(1).gif','anim(1).gif'],['(anim).gif','(anim).gif'],
   ['anim.gif,','anim.gif'],['anim.gif.','anim.gif'],['anim.gif;','anim.gif'],
   ['anim.gif)','anim.gif'],['anim.gif)),','anim.gif'],
  ];
  for(const [input,expected] of cases){
   await page.goto('https://fixture.test/article');await page.evaluate(({origin,text})=>{
    const main=document.querySelector('main');
    if(origin==='body')main.textContent='本文 '+text+' 続き';
    if(origin==='json'){const script=document.createElement('script');script.type='application/json';script.textContent=JSON.stringify({media:text});main.append(script);}
    if(origin==='attribute')main.setAttribute('data-candidate',text);
   },{origin,text:base+input});
   const result=await page.evaluate(scanDocument),url=base+expected;
   assert.deepEqual(result.images,[url],input);assert.deepEqual(result.media,[{url,kind:'gif'}],input);
   assert.deepEqual(normalizeImageUrls([...result.images,...result.media.map(m=>m.url)],result.url),[url.split('#')[0]],input);
  }
 }finally{await browser.close();}
});
