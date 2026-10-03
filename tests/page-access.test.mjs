import assert from "node:assert/strict";
import test from "node:test";
import {scanTab, scanUrl} from "../dist/extension/app/browser/page-access.js";

function mediaSnapshot(url, candidates = [], observed = []) {
  return {url, limited: false, posts: [{key: 'post:123', postId: '123', observed,
    roots: [{requireIdentity: false, player: false, value: {tweet: {rest_id: '123', legacy: {extended_entities: {
      media: candidates.map(item => item.kind === 'image' ? {type: 'photo', media_url_https: item.url} : {
        type: 'video', media_url_https: item.previewUrl,
        video_info: {variants: [item.url, ...(item.variantUrls ?? [])].map((url, index) => ({url, content_type: 'video/mp4', bitrate: index ? 1 : 10}))},
      }),
    }}}}}]}]};
}

for (const path of ["/i/history", "/i/bookmarks"]) {
  test(`${path}は投稿表示を待ち、写真の重複とプロフィールを除いて全メディアを結合する`, async t => {
    const url = `https://x.com${path}`;
    fixture(t, {get: async () => ({url})});
    const avatar = "https://pbs.twimg.com/profile_images/1/person.jpg";
    const photo = "https://pbs.twimg.com/media/first?name=small&format=jpg";
    const extraPhoto = "https://pbs.twimg.com/media/second.jpg";
    const video = {url: "https://video.twimg.com/clip.mp4", kind: "video", previewUrl: "https://pbs.twimg.com/media/poster.jpg"};
    const calls = [];
    let scans = 0;
    chrome.scripting.executeScript = async ({func, args}) => {
      calls.push(func.name);
      if (func.name === "waitForXPage") {
        assert.deepEqual(args, [false, 10_000]);
        return [{result: {status: "ready"}}];
      }
      if (func.name === "scanXMedia") return [{result: mediaSnapshot(url, [
        {url: "https://pbs.twimg.com/media/first.jpg", kind: "image"},
        {url: extraPhoto, kind: "image"},
        {url: "https://pbs.twimg.com/media/second?format=jpg&name=large", kind: "image"},
        video,
      ], [{url: photo, kind: "image"}])}];
      scans++;
      return [{result: {url, title: "History", images: scans === 1 ? [avatar] : [avatar, photo],
        media: [{url: avatar, kind: "image"}, ...(scans === 1 ? [] : [{url: photo, kind: "image"}])]}}];
    };
    const result = await scanTab(8, undefined, url);
    assert.deepEqual(calls, ["scanDocument", "waitForXPage", "scanDocument", "scanXMedia"]);
    assert.deepEqual(result.images, ["https://pbs.twimg.com/media/first?format=jpg&name=orig", "https://pbs.twimg.com/media/second?format=jpg&name=orig"]);
    assert.deepEqual(result.media, [{url: "https://pbs.twimg.com/media/first?format=jpg&name=orig", kind: "image"}, {url: "https://pbs.twimg.com/media/second?format=jpg&name=orig", kind: "image"}, video]);
  });
}

test("履歴画面の投稿が読み込めなければプロフィール画像だけで成功しない", async t => {
  const url = "https://x.com/i/history";
  fixture(t, {get: async () => ({url})});
  chrome.scripting.executeScript = async ({func}) => [{result: func.name === "waitForXPage"
    ? {status: "timeout"} : {url, title: "X", images: ["https://pbs.twimg.com/profile_images/1/person.jpg"]}}];
  await assert.rejects(scanTab(8), /読み込みが完了しませんでした/);
});

for (const change of ["url", "document"]) {
  test(`Xの追加解析中に${change}が変わった場合は結果を結合しない`, async t => {
    const url = "https://x.com/example/status/123";
    fixture(t, {get: async () => ({url})});
    let scans = 0;
    chrome.scripting.executeScript = async ({func}) => {
      if (func.name === "waitForXPage") return [{result: {status: "ready"}, documentId: "first"}];
      if (func.name === "scanXMedia") throw new Error("changed page must not be read");
      scans++;
      return [{
        result: {url: scans > 1 && change === "url" ? `${url}?page=2` : url, title: "post", images: []},
        documentId: scans > 1 && change === "document" ? "second" : "first"
      }];
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
      create: async options => {
        createdWindows.push(options);
        return {id: 17, tabs: [{id: 8}]};
      },
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
    if (injection.func.name === "scanXMedia")
      return [{result: mediaSnapshot(url, [{url: "https://video.twimg.com/example.mp4", kind: "video"}], [{url: "https://pbs.twimg.com/media/photo?format=jpg&name=orig", kind: "image"}])}];
    pageScans++;
    return [{
      result: {
        url,
        title: "post",
        images: pageScans === 1
          ? ["https://pbs.twimg.com/profile_images/1/avatar.jpg"]
          : ["https://pbs.twimg.com/media/photo.jpg", "https://pbs.twimg.com/profile_images/1/avatar.jpg"]
      }
    }];
  };
  const result = await scanTab(8, undefined, url);
  assert.equal(pageScans, 2);
  assert.deepEqual(result.images, ["https://pbs.twimg.com/media/photo?format=jpg&name=orig"]);
  assert.deepEqual(result.media, [{url: "https://video.twimg.com/example.mp4", kind: "video"}, {url: "https://pbs.twimg.com/media/photo?format=jpg&name=orig", kind: "image"}]);
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
    if (func.name === "scanXMedia") return [{result: mediaSnapshot(url)}];
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

for (const failure of ["unavailable", "incomplete"]) test(`Xの${failure}では確定済みの画像集合を置き換えない`, async t => {
  const url = "https://x.com/example/status/123";
  fixture(t, {query: async () => [{id: 8, url}], get: async () => ({url})});
  chrome.i18n = {getUILanguage: () => "ja"};
  const previousDocument = globalThis.document;
  globalThis.document = {documentElement: {setAttribute() {} }, querySelectorAll: () => []};
  t.after(() => { globalThis.document = previousDocument; });
  chrome.scripting.executeScript = async ({func}) => [{
    result: func.name === "waitForXPage"
      ? {status: failure === "unavailable" ? "unavailable" : "ready"}
      : func.name === "scanXMedia"
        ? mediaSnapshot(url, [], [{kind: "video", url: "blob:https://x.com/unresolved"}])
        : {url, title: "post", images: ["https://pbs.twimg.com/media/other.jpg"]}
  }];
  const {ImageCollection} = await import("../dist/extension/core/image-collection.js");
  const {createScanSessionController} = await import("../dist/extension/app/panel/scan-session-controller.js");
  const collection = new ImageCollection();
  collection.replace(["https://previous.test/retained.jpg"], "https://previous.test/page");
  const previousItems = collection.items;
  const messages = [];
  let published = false;
  const controller = createScanSessionController({
    collection,
    getEnteredUrl: () => "",
    getCollectionSession: () => null,
    clearAnalyzedUrl() {},
    markAnalyzedUrl() {},
    isBusy: () => false,
    isDisposed: () => false,
    onHideSourceInput() {},
    onShowSourceInput() {},
    onBusyChange() {},
    onStatus: message => messages.push(message),
    onResults: () => { published = true; },
  });
  await controller.start();
  assert.equal(collection.items, previousItems);
  assert.equal(published, false);
  assert.equal(controller.state, "results");
  assert.match(messages.at(-1), failure === "unavailable" ? /削除|表示できません/ : /一部取得できません/);
});


test("DOMの低画質URLを既知のvariantだけで置き換え、別動画と画像は残す", async t => {
  const url = "https://x.com/example/status/123/video/1";
  fixture(t, {get: async () => ({url})});
  const low = "https://video.twimg.com/one/low/clip.mp4", high = "https://video.twimg.com/one/high/clip.mp4";
  const other = "https://video.twimg.com/two/high/clip.mp4", photo = "https://images.test/photo.jpg";
  chrome.scripting.executeScript = async ({func}) => {
    if (func.name === "waitForXPage") return [{result: {status: "ready"}}];
    if (func.name === "scanXMedia") return [{result: mediaSnapshot(url, [{url: high, kind: "video", variantUrls: [low], previewUrl: "https://pbs.twimg.com/media/poster.jpg"}], [{url: low, kind: "video"}, {url: other, kind: "video"}, {url: photo, kind: "image"}])}];
    return [{result: {url, title: "post", images: [photo], media: [{url: low, kind: "video"}, {url: other, kind: "video"}, {url: photo, kind: "image"}]}}];
  };
  const result = await scanTab(8, undefined, url);
  assert.deepEqual(result.media, [{url: high, kind: "video", previewUrl: "https://pbs.twimg.com/media/poster.jpg"}, {url: other, kind: "video"}, {url: photo, kind: "image"}]);
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
        : name === "scanXMedia" ? mediaSnapshot(url) : {url, title: "post", images: []};
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
    if (func.name === "scanXMedia") return [{result: mediaSnapshot(url)}];
    scans += 1;
    return [{result: {url, title: "post", images: []}, ...(scans > 1 ? {documentId: "post"} : {})}];
  };
  const result = await scanTab(8);
  assert.equal(result.url, url);
  assert.deepEqual(result.media, []);
});

test("中止済みの解析はタブへ注入せず、一時ウィンドウも作らない", async t => {
  const state = fixture(t);
  let injections = 0;
  chrome.scripting.executeScript = async () => {
    injections += 1;
    return [];
  };
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

for (const outcome of ['ready', 'incomplete', 'disappeared', 'limited', 'moved', 'aborted']) {
  test(`不足投稿だけの再試行: ${outcome}`, async t => {
    const url = 'https://x.com/i/history';
    fixture(t, {get: async () => ({url})});
    const controller = new AbortController();
    const preview = 'https://pbs.twimg.com/ext_tw_video_thumb/1/img/poster.jpg';
    let reads = 0;
    chrome.scripting.executeScript = async ({func, args}) => {
      if (func.name === 'waitForXPage') return [{result: {status: 'ready'}}];
      if (func.name !== 'scanXMedia') return [{result: {url, title: 'X', images: []}}];
      reads++;
      if (reads === 2) {
        assert.deepEqual(args, [null, ['post:123']]);
        if (outcome === 'ready') return [{result: mediaSnapshot(url, [{url: 'https://video.twimg.com/clip.mp4', kind: 'video', previewUrl: preview}])}];
        if (outcome === 'disappeared') return [{result: mediaSnapshot(url)}];
        if (outcome === 'moved') return [{result: mediaSnapshot(url + '?changed=1')}];
      }
      const result = mediaSnapshot(url, [], [{kind: 'image', url: preview}]);
      if (outcome === 'limited') result.limited = true;
      if (outcome === 'aborted') queueMicrotask(() => controller.abort());
      return [{result}];
    };
    if (outcome === 'ready') assert.equal((await scanTab(8, controller.signal)).media[0].kind, 'video');
    else await assert.rejects(scanTab(8, controller.signal), outcome === 'limited' ? /読み取りきれず/ : outcome === 'moved' ? /ページが移動/ : outcome === 'aborted' ? /終了/ : /一部取得できません/);
    assert.equal(reads, ['limited', 'aborted'].includes(outcome) ? 1 : 2);
  });
}

for (const partial of [false, true]) test(`Xの画像と動画を表示し、部分取得=${partial}を区別する`, async t => {
  const url = 'https://x.com/i/history';
  fixture(t, {query: async () => [{id: 8, url}], get: async () => ({url})});
  const candidates = [{kind: 'image', url: 'https://pbs.twimg.com/media/photo.jpg'},
    {kind: 'video', url: 'https://video.twimg.com/clip.mp4'}];
  chrome.scripting.executeScript = async ({func}) => [{result: func.name === 'waitForXPage' ? {status: 'ready'}
    : func.name === 'scanXMedia' ? {...mediaSnapshot(url, candidates), limited: partial} : {url, title: 'X', images: []}}];
  const {ImageCollection} = await import('../dist/extension/core/image-collection.js');
  const {createScanSessionController} = await import('../dist/extension/app/panel/scan-session-controller.js');
  const collection = new ImageCollection();
  let initialGroup = 'not-published';
  let status = '';
  const controller = createScanSessionController({collection, getEnteredUrl: () => '', getCollectionSession: () => null,
    clearAnalyzedUrl() {}, markAnalyzedUrl() {}, isBusy: () => false, isDisposed: () => false,
    onHideSourceInput() {}, onShowSourceInput() {}, onBusyChange() {}, onStatus(message) {status = message;},
    onResults: (_title, group) => {initialGroup = group;}});
  await controller.start();
  assert.equal(initialGroup, null);
  assert.equal(controller.state, "results");
  assert.equal(status.length > 0, partial);
  assert.equal(collection.items.length, 2);
  assert.equal(controller.diagnostics.normalized, 2);
  assert.equal(controller.diagnostics.rejected, 0);
  assert.equal(controller.diagnostics.scan.posts, 1);
  assert.equal(JSON.stringify(controller.diagnostics).includes('https:'), false);
  controller.reset();
  assert.equal(controller.diagnostics, null);
});

for (const isX of [false, true]) {
  for (const changed of [false, true]) {
    test(`最終応答後の同一URL再読み込みをdocumentで確認する X=${isX} changed=${changed}`, async t => {
      const url = isX ? "https://x.com/example/status/123" : "https://example.com/page";
      let finalCheck = false;
      fixture(t, {get: async () => { finalCheck = true; return {url: `${url}#fragment`, status: "complete"}; }});
      chrome.scripting.executeScript = async ({func}) => {
        if (finalCheck) return [{result: `${url}#fragment`, documentId: changed ? "replacement" : "original"}];
        const result = func.name === "waitForXPage" ? {status: "ready"}
          : func.name === "scanXMedia" ? mediaSnapshot(url, [{kind: "image", url: "https://pbs.twimg.com/media/photo.jpg"}])
          : {url, title: "old", images: ["https://example.com/photo.jpg"]};
        return [{result, documentId: "original"}];
      };
      if (changed) await assert.rejects(scanTab(8, undefined, url), /ページが移動/);
      else assert.equal((await scanTab(8, undefined, url)).title, "old");
    });
  }
}
