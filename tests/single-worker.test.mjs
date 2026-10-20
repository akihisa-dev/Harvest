import assert from 'node:assert/strict';
import test from 'node:test';
import {runSingleWorker} from '../dist/extension/app/media/single-worker.js';

for(const outcome of ['success','reply-error','invalid','abort','timeout','post','error','messageerror','pre-abort','subscribe-abort','create'])test(`単発Workerの確定と解放: ${outcome}`,async t=>{
  let timer,cleared=0,terminated=0,sent=0,created=0;
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{assert.equal(delay,120000);timer=callback;return 123;});
  t.mock.method(globalThis,'clearTimeout',id=>{assert.equal(id,123);cleared++;});
  const controller=new AbortController(),subscriptions=new Set();
  const signal={get aborted(){return controller.signal.aborted;},addEventListener(_type,fn){subscriptions.add(fn);if(outcome==='subscribe-abort'){controller.abort();fn();}},removeEventListener(_type,fn){subscriptions.delete(fn);}};
  if(outcome==='pre-abort')controller.abort();
  const worker={postMessage(){sent++;if(outcome==='post')throw Error('post');},terminate(){terminated++;}};
  const p=runSingleWorker({create(){created++;if(outcome==='create')throw Error('create');return worker;},request:{fixture:true},signal,
    timeoutMs:120000,abortError:()=>new DOMException('abort','AbortError'),timeoutError:()=>Error('timeout'),failureError:()=>Error('failure'),
    receive(data,finish){if(data===true)finish(undefined,'result');else finish(Error(data==='error'?'reply':'invalid'));}});
  if(outcome==='success')worker.onmessage({data:true});
  if(outcome==='reply-error')worker.onmessage({data:'error'});
  if(outcome==='invalid')worker.onmessage({data:{}});
  if(outcome==='abort'){controller.abort();for(const fn of subscriptions)fn();}
  if(outcome==='timeout')timer();
  if(['error','messageerror'].includes(outcome))worker['on'+outcome]();
  if(outcome==='success')assert.equal(await p,'result');else await assert.rejects(p);
  if(['pre-abort','create'].includes(outcome)){assert.equal(cleared,0);assert.equal(terminated,0);assert.equal(sent,0);}
  else {
    assert.equal(cleared,1);assert.equal(terminated,1);assert.equal(subscriptions.size,0);
    worker.onmessage({data:true});worker.onerror();timer();
    assert.equal(cleared,1);assert.equal(terminated,1);
  }
  if(outcome==='pre-abort')assert.equal(created,0);
  if(outcome==='subscribe-abort')assert.equal(sent,0);
});

for(const media of ['audio','mp4','animation'])for(const outcome of ['success','reply-error','invalid','oversize','abort','timeout','post','error','messageerror'])test(`${media}の媒体契約と終了保証: ${outcome}`,async t=>{
  const {prepareAudio}=await import('../dist/extension/app/media/audio-conversion.js');
  const {prepareMp4}=await import('../dist/extension/app/media/mp4-conversion.js');
  const {prepareAnimatedImage}=await import('../dist/extension/app/media/animated-image.js');
  const {animatedWebp}=await import('./animation-fixtures.mjs');
  let worker,timer,cleared=0,terminated=0;
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);else delete globalThis.Worker;});
  globalThis.Worker=class {constructor(){worker=this;}postMessage(){if(outcome==='post')throw Error('post');}terminate(){terminated++;}};
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{assert.equal(delay,120000);timer=callback;return 12;});
  t.mock.method(globalThis,'clearTimeout',()=>{cleared++;});
  const controller=new AbortController(),blob=new Blob(['input'],{type:'video/webm'});
  const result=new Blob([outcome==='oversize'?'12345':'ok'],{type:media==='audio'?'audio/mpeg':media==='mp4'?'video/mp4':'image/gif'});
  const p=media==='audio'?prepareAudio(blob,controller.signal,4):media==='mp4'?prepareMp4(blob,controller.signal,4):prepareAnimatedImage({kind:'bitmap',blob:new Blob([animatedWebp],{type:'image/webp'})},controller.signal,4);
  const settled=p.then(value=>({value}),error=>({error}));
  await new Promise(resolve=>setImmediate(resolve));
  if(['success','oversize'].includes(outcome))worker.onmessage({data:{blob:result}});
  if(outcome==='reply-error')worker.onmessage({data:{error:'fixture-error'}});
  if(outcome==='invalid')worker.onmessage({data:{blob:null}});
  if(outcome==='abort')controller.abort();
  if(outcome==='timeout')timer();
  if(['error','messageerror'].includes(outcome))worker['on'+outcome]();
  const actual=await settled;
  if(outcome==='success')assert.equal(actual.value,result);else assert.ok(actual.error);
  if(outcome==='oversize')assert.match(actual.error.message,/上限/);
  if(outcome==='invalid')assert.match(actual.error.message,/空/);
  assert.equal(terminated,1);assert.equal(cleared,1);
  worker.onmessage({data:{blob:result}});assert.equal(terminated,1);
});
