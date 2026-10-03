import assert from "node:assert/strict";
import test from "node:test";
import {ImageCollection} from "../dist/extension/core/image-collection.js";
import {createScanSessionController} from "../dist/extension/app/panel/scan-session-controller.js";

function setup(t) {
  const previous = globalThis.chrome;
  const collection = new ImageCollection();
  const source = "https://example.test/page";
  const nextImage = "https://example.test/new.png";
  const busy = [];
  const statuses = [];
  const results = [];
  let disposed = false;
  let queryCount = 0;
  let scriptCount = 0;
  let query = async () => [{id: 7, url: source}];
  let read = async () => [{result: {url: source, title: "Page", images: [nextImage]}}];
  globalThis.chrome = {
    tabs: {
      query: () => { queryCount++; return query(); },
      get: async () => ({url: source}),
      onRemoved: {addListener() {}, removeListener() {}},
    },
    scripting: {executeScript: (...args) => { scriptCount++; return read(...args); }},
  };
  t.after(() => { globalThis.chrome = previous; });
  const controller = createScanSessionController({
    collection,
    getEnteredUrl: () => "",
    getCollectionSession: () => null,
    clearAnalyzedUrl() {},
    markAnalyzedUrl() {},
    // The controller must enforce its own ownership even before an external
    // view has reflected the busy notification.
    isBusy: () => false,
    isDisposed: () => disposed,
    onHideSourceInput() {},
    onShowSourceInput() {},
    onBusyChange: value => busy.push(value),
    onStatus: (...args) => statuses.push(args),
    onResults: (...args) => results.push(args),
  });
  return {
    controller, collection, source, nextImage, busy, statuses, results,
    set disposed(value) { disposed = value; },
    set query(value) { query = value; },
    set read(value) { read = value; },
    get queryCount() { return queryCount; },
    get scriptCount() { return scriptCount; },
  };
}

test("解析controller自身が多重開始を防ぎ、完了結果を一度だけ公開する", async t => {
  const fixture = setup(t);
  let resolve;
  fixture.query = () => new Promise(done => { resolve = done; });
  const execution = fixture.controller.start();
  await fixture.controller.start();
  assert.equal(fixture.queryCount, 1);
  assert.equal(fixture.controller.isRunning, true);
  resolve([{id: 7, url: fixture.source}]);
  await execution;
  assert.deepEqual(fixture.collection.items.map(item => item.url), [fixture.nextImage]);
  assert.equal(fixture.results.length, 1);
  assert.equal(fixture.controller.state, "results");
  assert.equal(fixture.controller.isRunning, false);
  assert.deepEqual(fixture.busy, [true, false]);
});

for (const action of ["reset", "dispose"]) {
  test(`${action}後に返ったタブで解析を始めず、以前の結果を維持する`, async t => {
    const fixture = setup(t);
    fixture.collection.replace(["https://example.test/old.png"], fixture.source);
    const oldItems = fixture.collection.items;
    let resolve;
    fixture.query = () => new Promise(done => { resolve = done; });
    const execution = fixture.controller.start();
    if (action === "reset") fixture.controller.reset();
    else fixture.disposed = true;
    resolve([{id: 7, url: fixture.source}]);
    await execution;
    assert.equal(fixture.scriptCount, 0);
    assert.equal(fixture.collection.items, oldItems);
    assert.deepEqual(fixture.results, []);
    assert.equal(fixture.controller.isRunning, false);
    if (action === "reset") {
      assert.equal(fixture.controller.state, "initial");
      assert.equal(fixture.controller.diagnostics, null);
      assert.deepEqual(fixture.busy, [true, false]);
    } else {
      await fixture.controller.start();
      assert.equal(fixture.queryCount, 1, "廃棄後は新たな解析も開始しない");
      assert.deepEqual(fixture.busy, [true], "廃棄済みの画面に完了を通知しない");
    }
  });
}

test("ページ読み取り失敗時には以前の選択・順序を原子的に維持する", async t => {
  const fixture = setup(t);
  fixture.collection.replace(["https://example.test/old.png"], fixture.source);
  const oldItems = fixture.collection.items;
  fixture.read = async () => { throw new Error("read failure"); };
  await fixture.controller.start();
  assert.equal(fixture.collection.items, oldItems);
  assert.deepEqual(fixture.results, []);
  assert.equal(fixture.controller.state, "results");
  assert.equal(fixture.statuses.at(-1)[1], "error");
  assert.deepEqual(fixture.busy, [true, false]);
});

test('続き取得中の停止は取得済み画像を公開し、それ以上取得しない',async t=>{
  const f=setup(t),url='https://x.com/i/history';
  f.query=async()=>[{id:7,url}];chrome.tabs.get=async()=>({url});
  let requests=0;
  f.read=async({func})=>{
    if(func.name==='fetchXBookmarkPage'){
      requests++;f.controller.stop();
      return [{result:{status:'advanced',cursor:'next'}}];
    }
    if(func.name==='scanXMedia')return [{result:{url,limited:false,bookmarkContinuation:true,posts:
      Array.from({length:requests+1},(_,i)=>({key:`post:${i+1}`,postId:String(i+1),observed:[],roots:[{requireIdentity:false,player:false,
        value:{rest_id:String(i+1),extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${i+1}.jpg`}]}}}]}))}}];
    return [{result:{url,title:'Bookmarks',images:[]}}];
  };
  await f.controller.start();
  assert.equal(requests,1);
  assert.equal(f.collection.items.length,2);
  assert.equal(f.controller.diagnostics.scan.bookmarkStopped,true);
  assert.equal(f.controller.state,'results');
  assert.equal(f.controller.isRunning,false);
});
