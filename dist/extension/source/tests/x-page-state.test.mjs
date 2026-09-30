import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForXPage} from '../dist/extension/app/x-page-state.js';

async function withPage(document, callback) {
  const previous=globalThis.document;
  globalThis.document=document;
  try {return await callback();} finally {
    if(previous===undefined) delete globalThis.document;
    else globalThis.document=previous;
  }
}

test('投稿の表示制限を検出し、初期ロード完了だけではreadyにしない', async()=> {
  await withPage({body:{innerText:'このポストはXアプリでのみ表示できます'},querySelector:()=>null},async()=>{
    assert.deepEqual(await waitForXPage(true,100),{status:'restricted'});
  });
  await withPage({body:{innerText:''},querySelector:()=>null},async()=>{
    assert.deepEqual(await waitForXPage(true,100),{status:'timeout'});
  });
});

test('後から追加された動画プレイヤーを待ち、投稿本文の同じ文言を制限と誤認しない',async()=>{
  const start=performance.now();
  await withPage({body:{innerText:'This post is unavailable'},querySelector:selector=>{
    if(selector==='main') return null;
    if(selector.startsWith('article')) return {};
    return performance.now()-start>120 ? {} : null;
  }},async()=>{
    assert.deepEqual(await waitForXPage(true,1000),{status:'ready'});
  });
});
