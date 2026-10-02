import assert from "node:assert/strict";
import test from "node:test";
import { scanTab, scanUrl } from "../dist/extension/app/page-access.js";

for (const change of ["url", "document"]) {
  test(`Xの追加解析中に${change}が変わった場合は結果を結合しない`, async t => {
    const url = "https://x.com/example/status/123";
    fixture(t, {get:async () => ({url})});
    let scans = 0;
    chrome.scripting.executeScript = async ({func}) => {
      if (func.name === "waitForXPage") return [{result:{status:"ready"}, documentId:"first"}];
      if (func.name === "scanXMedia") throw new Error("changed page must not be read");
      scans++;
      return [{result:{url:scans > 1 && change === "url" ? `${url}?page=2` : url, title:"post",images:[]},
        documentId:scans > 1 && change === "document" ? "second" : "first"}];
    };
    await assert.rejects(scanTab(8, undefined, url), /ページが移動/);
  });
}

test("解析開始前に完了したリダイレクトは移動先を出典にする", async t => {
  fixture(t);
  const result = await scanUrl("https://example.com/redirect");
  assert.equal(result.url, "https://example.com/page");
});

function fixture(t, overrides = {}) {
  const updated = new Set();
  const removed = new Set();
  const closedWindowIds = [];
  const createdWindows = [];
  const previous = globalThis.chrome;
  const {windows: windowOverrides = {}, ...tabOverrides} = overrides;
  globalThis.chrome = {
    tabs: {
      create: async () => { throw new Error("tabs.create should not be called"); },
      get: async () => ({status: "complete", url: "https://example.com/page"}),
      remove: async () => {},
      onUpdated: {addListener: fn => updated.add(fn), removeListener: fn => updated.delete(fn)},
      onRemoved: {addListener: fn => removed.add(fn), removeListener: fn => removed.delete(fn)},
      ...tabOverrides,
    },
    windows: {
      create: async options => { createdWindows.push(options); return {id: 17, tabs: [{id: 8}]}; },
      remove: async id => { closedWindowIds.push(id); },
      ...windowOverrides,
    },
    scripting: {executeScript: async () => [{result: {url: "https://example.com/page", title: "page", images: []}}]},
  };
  t.after(() => { globalThis.chrome = previous; });
  return {updated, removed, closedWindowIds, createdWindows};
}

test("一時タブの読み込み完了後に解析し、タブと待機リスナーを解放する", async t => {
  const state = fixture(t);
  assert.equal((await scanUrl("https://example.com/page")).title, "page");
  assert.deepEqual(state.createdWindows, [{url: "https://example.com/page", focused: false, state: "minimized", type: "normal"}]);
  assert.deepEqual(state.closedWindowIds, [17]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("タブが途中で閉じられた場合は時間切れを待たずに失敗し後始末する", async t => {
  const state = fixture(t, {get: async () => ({status: "loading"})});
  const work = scanUrl("https://example.com/page");
  const rejected = assert.rejects(work, /閉じられました/);
  await Promise.resolve();
  for (const listener of state.removed) listener(8);
  await rejected;
  assert.deepEqual(state.closedWindowIds, [17]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("一時タブの取得失敗でもリスナーとタブを解放する", async t => {
  const state = fixture(t, {get: async () => { throw new Error("missing tab"); }});
  await assert.rejects(scanUrl("https://example.com/page"), /開けません/);
  assert.deepEqual(state.closedWindowIds, [17]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("読み込みが完了しないタブは時間切れになり解放される", async t => {
  const state = fixture(t, {get: async () => ({status: "loading"})});
  t.mock.timers.enable({apis: ["setTimeout"]});
  const rejected = assert.rejects(scanUrl("https://example.com/page"), /時間切れ/);
  await Promise.resolve();
  t.mock.timers.tick(20000);
  await rejected;
  assert.deepEqual(state.closedWindowIds, [17]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("パネル終了による中断は待機を解放し、遅い解析結果を受け取らない", async t => {
  const state = fixture(t);
  let finish;
  chrome.scripting.executeScript = () => new Promise(resolve => { finish = resolve; });
  const controller = new AbortController();
  const rejected = assert.rejects(scanUrl("https://example.com/page", controller.signal), /終了しました/);
  for (let i = 0; i < 5 && !finish; i++) await Promise.resolve();
  assert.ok(finish);
  controller.abort();
  await rejected;
  finish([{result: {url: "https://example.com/page", title: "late", images: []}}]);
  assert.deepEqual(state.closedWindowIds, [17]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("作成されたウィンドウのタブIDがない場合もウィンドウ全体を閉じる", async t => {
  const state = fixture(t, {windows: {create: async () => ({id: 17, tabs: [{}]})}});
  await assert.rejects(scanUrl("https://example.com/page"), /開けません/);
  assert.deepEqual(state.closedWindowIds, [17]);
});

test("作成されたウィンドウのIDがない場合は他のウィンドウを閉じずに失敗する", async t => {
  const state = fixture(t, {windows: {create: async () => ({tabs: [{id: 8}]})}});
  await assert.rejects(scanUrl("https://example.com/page"), /開けません/);
  assert.deepEqual(state.closedWindowIds, []);
});

test("ウィンドウ作成中に中断しても遅れて作成されたウィンドウを閉じる", async t => {
  const state = fixture(t, {windows: {create: () => new Promise(resolve => { state.resolveCreate = resolve; })}});
  const controller = new AbortController();
  const rejected = assert.rejects(scanUrl("https://example.com/page", controller.signal), /終了しました/);
  for (let i = 0; i < 5 && !state.resolveCreate; i++) await Promise.resolve();
  assert.ok(state.resolveCreate);
  controller.abort();
  state.resolveCreate({id: 17, tabs: [{id: 8}]});
  await rejected;
  assert.deepEqual(state.closedWindowIds, [17]);
});

test("解析中に別ページへ移動したタブの古い結果を採用しない", async t => {
  fixture(t, {get: async () => ({url: "https://example.com/next"})});
  await assert.rejects(scanTab(8), /ページが移動/);
});

test("解析自体が応答しない場合にも時間切れになる", async t => {
  fixture(t);
  t.mock.timers.enable({apis: ["setTimeout"]});
  chrome.scripting.executeScript = () => new Promise(() => {});
  const rejected = assert.rejects(scanTab(8), /時間切れ/);
  t.mock.timers.tick(20000);
  await rejected;
});

test("読み込み後の解析中にタブが閉じられても即座に失敗する", async t => {
  const state = fixture(t);
  chrome.scripting.executeScript = () => new Promise(() => {});
  const rejected = assert.rejects(scanTab(8), /閉じられました/);
  for (const listener of state.removed) listener(8);
  await rejected;
  assert.equal(state.removed.size, 0);
});

test("X動画ページは投稿の読み込みを待って再解析し、MAINでプレイヤー情報を読む", async t => {
  const url = "https://x.com/example/status/123/video/1";
  fixture(t, {get: async () => ({url})});
  const calls = [];
  let pageScans = 0;
  chrome.scripting.executeScript = async injection => {
    calls.push({name: injection.func.name, world: injection.world, args: injection.args});
    if (injection.func.name === "waitForXPage") return [{result: {status: "ready"}}];
    if (injection.func.name === "scanXMedia") return [{result: [{url: "https://video.twimg.com/example.mp4", kind: "video"}]}];
    pageScans++;
    return [{result: {url, title: "post", images: pageScans === 1 ? ["https://pbs.twimg.com/profile_images/1/avatar.jpg"] : ["https://pbs.twimg.com/media/photo.jpg", "https://pbs.twimg.com/profile_images/1/avatar.jpg"]}}];
  };
  const result = await scanTab(8, undefined, url);
  assert.equal(pageScans, 2);
  assert.deepEqual(result.images, ["https://pbs.twimg.com/media/photo.jpg"]);
  assert.deepEqual(result.media, [{url: "https://video.twimg.com/example.mp4", kind: "video"}]);
  assert.deepEqual(calls.map(call => call.name), ["scanDocument", "waitForXPage", "scanDocument", "scanXMedia"]);
  assert.deepEqual(calls[1].args, [true, 10_000, "123"]);
  assert.deepEqual(calls[2].args, ["123"]);
  assert.deepEqual(calls[3].args, ["123"]);
  assert.equal(calls[3].world, "MAIN");
});

test("Xが投稿を制限している場合、プロフィール画像を成功した結果として返さない", async t => {
  const url = "https://x.com/example/status/123";
  fixture(t, {get: async () => ({url})});
  chrome.scripting.executeScript = async ({func}) => [{result: func.name === "waitForXPage" ? {status: "restricted"} : {url, title: "post", images: ["https://pbs.twimg.com/profile_images/1/avatar.jpg"]}}];
  await assert.rejects(scanTab(8), /表示を制限/);
});

test("X動画ページでMP4を読めない場合は理由を示し、画像だけの成功にしない", async t => {
  const url = "https://x.com/example/status/123/video/1";
  fixture(t, {get: async () => ({url})});
  chrome.scripting.executeScript = async ({func}) => {
    if (func.name === "waitForXPage") return [{result: {status: "ready"}}];
    if (func.name === "scanXMedia") return [{result: []}];
    return [{result: {url, title: "post", images: []}}];
  };
  await assert.rejects(scanTab(8), /MP4のURLを取得できません/);
});

test("Xの読み込み待機中の中止で遅い結果を採用しない", async t => {
  const url = "https://x.com/example/status/123/video/1";
  fixture(t, {get: async () => ({url})});
  let finish;
  chrome.scripting.executeScript = async ({func}) => {
    if (func.name === "waitForXPage") return new Promise(resolve => { finish = resolve; });
    return [{result: {url, title: "post", images: []}}];
  };
  const controller = new AbortController();
  const work = scanTab(8, controller.signal, url);
  const rejected = assert.rejects(work, /終了しました/);
  for (let index = 0; index < 10 && !finish; index++) await Promise.resolve();
  assert.ok(finish);
  controller.abort();
  await rejected;
  finish([{result: {status: "ready"}}]);
});

test("Xの対象投稿の解析失敗では確定済みの画像集合を置き換えない", async t => {
  const url = "https://x.com/example/status/123";
  fixture(t, {query: async () => [{id: 8, url}], get: async () => ({url})});
  chrome.i18n = {getUILanguage: () => "ja"};
  const previousDocument = globalThis.document;
  globalThis.document = {documentElement: {setAttribute() {}}, querySelectorAll: () => []};
  t.after(() => { globalThis.document = previousDocument; });
  chrome.scripting.executeScript = async ({func}) => [{result: func.name === "waitForXPage"
    ? {status: "unavailable"} : {url, title: "post", images: ["https://pbs.twimg.com/media/other.jpg"]}}];
  const {ImageCollection} = await import("../dist/extension/core/image-collection.js");
  const {createScanSessionController} = await import("../dist/extension/app/scan-session-controller.js");
  const collection = new ImageCollection();
  collection.replace(["https://previous.test/retained.jpg"], "https://previous.test/page");
  const previousItems = collection.items;
  const messages = [];
  let published = false;
  const controller = createScanSessionController({
    collection, getEnteredUrl: () => "", getCollectionSession: () => null,
    clearAnalyzedUrl() {}, markAnalyzedUrl() {}, isBusy: () => false, isDisposed: () => false,
    onHideSourceInput() {}, onShowSourceInput() {}, onBusyChange() {},
    onStatus: message => messages.push(message), onResults: () => { published = true; },
  });
  await controller.start();
  assert.equal(collection.items, previousItems);
  assert.equal(published, false);
  assert.equal(controller.state, "results");
  assert.match(messages.at(-1), /削除|表示できません/);
});


test("DOMの低画質URLを既知のvariantだけで置き換え、別動画と画像は残す", async t => {
  const url = "https://x.com/example/status/123/video/1";
  fixture(t, {get:async () => ({url})});
  const low = "https://video.twimg.com/one/low/clip.mp4", high = "https://video.twimg.com/one/high/clip.mp4";
  const other = "https://video.twimg.com/two/high/clip.mp4", photo = "https://images.test/photo.jpg";
  chrome.scripting.executeScript = async ({func}) => {
    if (func.name === "waitForXPage") return [{result:{status:"ready"}}];
    if (func.name === "scanXMedia") return [{result:[{url:high, kind:"video", variantUrls:[low], previewUrl:photo}]}];
    return [{result:{url, title:"post", images:[photo], media:[{url:low,kind:"video"},{url:other,kind:"video"},{url:photo,kind:"image"}]}}];
  };
  const result = await scanTab(8, undefined, url);
  assert.deepEqual(result.media, [{url:other,kind:"video"},{url:photo,kind:"image"},{url:high,kind:"video",previewUrl:photo}]);
  assert.deepEqual(result.images, [photo]);
});

for (const stage of ["waitForXPage", "scanPost", "scanXMedia"]) {
  test(`Xの${stage}が別documentへ到達した場合は後続処理と結果公開を止める`, async t => {
    const url = "https://x.com/example/status/123";
    const state = fixture(t, {get: async () => ({url})});
    const calls = [];
    chrome.scripting.executeScript = async ({func, args}) => {
      const name = func.name === "scanDocument" && args?.length ? "scanPost" : func.name;
      calls.push(name);
      const result = name === "waitForXPage" ? {status: "ready"}
        : name === "scanXMedia" ? [] : {url, title: "post", images: []};
      return [{result, documentId: name === stage ? "replacement" : "original"}];
    };
    await assert.rejects(scanTab(8), /ページが移動/);
    assert.equal(calls.at(-1), stage);
    assert.equal(state.removed.size, 0);
  });
}

test("初回にdocument IDがない環境では後続のIDを採用せず、hashだけの移動を許容する", async t => {
  const url = "https://x.com/example/status/123";
  fixture(t, {get: async () => ({url: `${url}#details`})});
  let scans = 0;
  chrome.scripting.executeScript = async ({func}) => {
    if (func.name === "waitForXPage") return [{result: {status: "ready"}, documentId: "wait"}];
    if (func.name === "scanXMedia") return [];
    scans += 1;
    return [{result: {url, title: "post", images: []}, ...(scans > 1 ? {documentId: "post"} : {})}];
  };
  assert.deepEqual(await scanTab(8), {url, title: "post", images: [], media: []});
});

test("中止済みの解析はタブへ注入せず、一時ウィンドウも作らない", async t => {
  const state = fixture(t);
  let injections = 0;
  chrome.scripting.executeScript = async () => { injections += 1; return []; };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scanTab(8, controller.signal), /終了しました/);
  await assert.rejects(scanUrl("https://example.com/page", controller.signal), /終了しました/);
  assert.equal(injections, 0);
  assert.deepEqual(state.createdWindows, []);
  assert.equal(state.removed.size + state.updated.size, 0);
});

test("各注入段階の失敗理由を保ち、初回の読み取り失敗でも監視を解放する", async t => {
  const url = "https://x.com/example/status/123";
  const state = fixture(t, {get: async () => ({url})});
  for (const [stage, expected] of [
    ["scanDocument", "このページを読み取れませんでした。Chromeで開けるWebページを指定してください。"],
    ["waitForXPage", "Xの投稿を読み取れませんでした。"],
    ["scanPost", "Xの投稿を読み取れませんでした。"],
    ["scanXMedia", "Xの動画情報を読み取れませんでした。"],
  ]) {
    chrome.scripting.executeScript = async ({func, args}) => {
      const name = func.name === "scanDocument" && args?.length ? "scanPost" : func.name;
      if (name === stage) throw new Error("Chrome rejected the injection");
      return [{result: name === "waitForXPage" ? {status: "ready"} : {url, title: "post", images: []}}];
    };
    await assert.rejects(scanTab(8), {message: expected});
    assert.equal(state.removed.size, 0);
  }
});
