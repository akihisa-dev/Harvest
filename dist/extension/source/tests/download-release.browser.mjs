import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,stat} from 'node:fs/promises';
import {chromium} from 'playwright';

test('大容量PDFとZIPの連続ダウンロードを保持時間なしで開始し、各Blob URLを解放する',async()=>{
 const source=await readFile(new URL('../dist/extension/app/export-lifecycle.js',import.meta.url),'utf8');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({acceptDownloads:true});
  await page.evaluate(async source=>{
   const moduleUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
   const {downloadBlob}=await import(moduleUrl);URL.revokeObjectURL(moduleUrl);
   window.saveFixture=downloadBlob;window.urls=[];window.revoked=[];
   const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
   URL.createObjectURL=blob=>{const url=create(blob);window.urls.push(url);return url;};
   URL.revokeObjectURL=url=>{window.revoked.push(url);revoke(url);};
  },source);
  for (const [ext,mime] of [['pdf','application/pdf'],['zip','application/zip']]) {
   const event=page.waitForEvent('download');
   await page.evaluate(({ext,mime})=>{
    const bytes=new Uint8Array(16*1024*1024);bytes.fill(0x41);window.saveFixture(new Blob([bytes],{type:mime}),`fixture.${ext}`);
   },{ext,mime});
   const download=await event;
   assert.equal(await download.failure(),null);assert.equal(download.suggestedFilename(),`fixture.${ext}`);
   assert.equal((await stat(await download.path())).size,16*1024*1024);
   await page.waitForFunction(()=>window.urls.length===window.revoked.length);
  }
  const references=await page.evaluate(()=>({created:window.urls,revoked:window.revoked}));
  assert.deepEqual(references.revoked,references.created);
 } finally {await browser.close();}
});
