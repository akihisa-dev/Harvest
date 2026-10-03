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

for (const phase of ["query", "initial", "post-wait"]) {
  test(`${phase}で繰り返し停止しても旧選択・順序を保持し、遅い応答を公開せず再解析できる`, async t => {
    const f = setup(t);
    const url = phase === "post-wait" ? "https://x.com/user/status/123" : f.source;
    f.collection.replace(["https://example.test/old1.png", "https://example.test/old2.png"], f.source);
    f.collection.setSelected(f.collection.items[0].url, false);
    f.collection.applyVisibleOrder(f.collection.items, [...f.collection.items].reverse());
    const previous = f.collection.items;
    const previousSelection = previous.map(item => item.selected);
    let release, reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    const gate = () => new Promise(resolve => { release = resolve; reached(); });
    if (phase === "query") f.query = gate;
    else {
      f.query = async () => [{id: 7, url}];
      chrome.tabs.get = async () => ({url});
      f.read = async ({func}) => {
        if (func.name === (phase === "initial" ? "scanDocument" : "waitForXPage")) return gate();
        return [{result: {url, title: "Page", images: []}, documentId: "fixture"}];
      };
    }
    const execution = f.controller.start();
    await waiting;
    f.controller.stop(); f.controller.stop(); f.controller.stop();
    await f.controller.start(); // Until ownership is released, a start is ignored.
    if (phase === "query") release([{id: 7, url}]);
    await execution;
    assert.equal(f.controller.isRunning, false);
    assert.equal(f.controller.state, "results");
    assert.equal(f.collection.items, previous);
    assert.deepEqual(previous.map(item => item.selected), previousSelection);
    assert.deepEqual(f.results, []);
    assert.equal(f.statuses.at(-1)[1], "info");
    assert.deepEqual(f.busy, [true, false]);
    if (phase !== "query") {
      release([{result: phase === "post-wait" ? {status: "ready"} : {url, title: "Late", images: [f.nextImage]}, documentId: "fixture"}]);
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(f.collection.items, previous);
      assert.deepEqual(f.results, []);
    } else assert.equal(f.scriptCount, 0);
    f.query = async () => [{id: 7, url: f.source}];
    chrome.tabs.get = async () => ({url: f.source});
    f.read = async () => [{result: {url: f.source, title: "New", images: [f.nextImage]}}];
    await f.controller.start();
    assert.deepEqual(f.collection.items.map(item => item.url), [f.nextImage]);
    assert.equal(f.results.length, 1);
    assert.deepEqual(f.busy, [true, false, true, false]);
  });
}

test("初回解析を停止すると空の初期画面へ戻り、エラー扱いにしない", async t => {
  const f = setup(t);
  let release;
  f.query = () => new Promise(resolve => { release = resolve; });
  const execution = f.controller.start();
  f.controller.stop();
  release([{id: 7, url: f.source}]);
  await execution;
  assert.equal(f.controller.state, "initial");
  assert.equal(f.controller.isRunning, false);
  assert.equal(f.statuses.at(-1)[1], "info");
  assert.deepEqual(f.results, []);
});

for (const ending of ["advanced", "end", "failed"]) for (const list of ["other", "bookmarks", "unknown"]) {
  test(`${ending}後の一覧${list}を継続取得能力と区別して公開する`, async t => {
    const f = setup(t), url = "https://x.com/i/history";
    f.collection.replace(["https://example.test/A1.png", "https://example.test/A2.png"], f.source);
    f.collection.setSelected(f.collection.items[0].url, false);
    f.collection.applyVisibleOrder(f.collection.items, [...f.collection.items].reverse());
    const previous = f.collection.items;
    const selection = previous.map(item => item.selected);
    f.query = async () => [{id: 7, url}]; chrome.tabs.get = async () => ({url});
    let fetched = false;
    const post = id => ({key: `post:${id}`, postId: id, observed: [], roots: [{requireIdentity: false, player: false,
      value: {rest_id: id, extended_entities: {media: [{type: "photo", media_url_https: `https://pbs.twimg.com/media/image${id}.jpg`}]}}}]});
    f.read = async ({func}) => {
      if (func.name === "fetchXBookmarkPage") { fetched = true; return [{result: {status: ending, ...(ending === "advanced" ? {cursor: "next"} : {})}}]; }
      if (func.name === "scanXMedia") return [{result: {url, limited: false,
        bookmarkContinuation: !fetched,
        ...(fetched && list === "unknown" ? {} : {bookmarkList: fetched ? list : "bookmarks"}),
        posts: [post(fetched ? list === "other" ? "99" : "2" : "1")],
      }}];
      return [{result: {url, title: "Bookmarks", images: []}}];
    };
    await f.controller.start();
    assert.equal(f.controller.isRunning, false);
    if (list === "other") {
      assert.equal(f.collection.items, previous);
      assert.deepEqual(previous.map(item => item.selected), selection);
      assert.deepEqual(f.results, []);
      assert.match(f.statuses.at(-1)[0], /ページが移動/);
      assert.equal(f.statuses.at(-1)[1], "error");
    } else {
      const expected = list === "bookmarks" ? ["1", "2"] : ["1"];
      assert.deepEqual(f.collection.items.map(item => item.url), expected.map(id => `https://pbs.twimg.com/media/image${id}?format=jpg&name=orig`));
      assert.equal(f.results.length, 1);
      assert.equal(f.controller.diagnostics.scan.bookmarkIncomplete, ending === "end" && list === "bookmarks" ? undefined : true);
    }
  });
}
