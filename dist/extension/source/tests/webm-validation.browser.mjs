import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {webmBytes} from './original-fixtures.mjs';

test('多数要素のWebM構造検査中もパネルのタイマーと中止を処理し、次の検査を実行できる',async t=>{
  const {page}=await animationPanel(t,new Map());
  const result=await page.evaluate(async fixture=>{
    const {validateWebm}=await import(chrome.runtime.getURL('app/media/webm-validation.js'));
    const {hasCompleteWebm}=await import(chrome.runtime.getURL('core/webm-structure.js'));
    const original=new Uint8Array(fixture);
    // Void elements after the finite Segment remain valid top-level EBML.
    const bytes=new Uint8Array(original.length+8*1024*1024);bytes.set(original);
    for(let at=original.length;at<bytes.length;at+=2)bytes.set([0xec,0x80],at);
    const expected=hasCompleteWebm(bytes);
    let created=0,terminated=0;
    const Native=Worker;
    window.Worker=class extends Native {constructor(...args){super(...args);created++;}terminate(){terminated++;super.terminate();}};
    const controller=new AbortController();
    const work=validateWebm(bytes,controller.signal);let ticked=false,aborted;
    setTimeout(()=>{ticked=true;controller.abort();},0);
    try{await work;}catch(error){aborted=error.name;}
    const valid=await validateWebm(new Uint8Array(fixture));
    const invalid=await validateWebm(new Uint8Array(fixture.slice(0,-1)));
    return {expected,ticked,aborted,valid,invalid,created,terminated,detached:bytes.byteLength===0};
  },[...webmBytes]);
  assert.deepEqual(result,{expected:true,ticked:true,aborted:'AbortError',valid:true,invalid:false,created:3,terminated:3,detached:true});
});
