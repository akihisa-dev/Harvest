import assert from "node:assert/strict";
import test from "node:test";
import {createCollectionController} from "../dist/extension/app/panel/collection-controller.js";

function setup() {
  const previousChrome = globalThis.chrome;
  let onConnect;
  let connectionTabId = 7;
  let query;
  let executeScript;
  const injections = [];
  const ports = [];
  const scans = [];
  let exports = 0;
  let busy = false;
  let disposed = false;
  let canExport = true;
  let throwOnPublish = false;
  const errors = [];
  const button = {
    textContent: "",
    attributes: new Map(),
    listeners: new Map(),
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    click() { this.listeners.get("click")?.(); },
  };

  function connect(name, tabId) {
    const port = {
      name,
      sender: {tab: {id: tabId}},
      messages: [],
      disconnectCount: 0,
      onMessageListener: undefined,
      onDisconnectListener: undefined,
      postMessage(message) {
        if (throwOnPublish) throw new Error("Port is disconnected");
        this.messages.push(message);
      },
      disconnect() { this.disconnectCount += 1; },
      onMessage: {addListener(listener) { port.onMessageListener = listener; } },
      onDisconnect: {addListener(listener) { port.onDisconnectListener = listener; } },
      send(message) { this.onMessageListener?.(message); },
      disconnectFromPage() { this.onDisconnectListener?.(); },
    };
    ports.push(port);
    onConnect(port);
    return port;
  }

  executeScript = async injection => {
    injections.push(injection);
    connect(injection.args[0], connectionTabId);
    return [];
  };
  globalThis.chrome = {
    runtime: {onConnect: {addListener(listener) { onConnect = listener; } }},
    tabs: {query: (...args) => query ? query(...args) : Promise.resolve([{id: 7, url: "https://example.test/view"}])},
    scripting: {executeScript: injection => executeScript(injection)},
  };

  const controller = createCollectionController({
    button,
    startLabel: "start",
    stopLabel: "stop",
    noPageError: "no page",
    isBusy: () => busy,
    isDisposed: () => disposed,
    canExport: () => canExport,
    onScanUrl: url => scans.push(url),
    onExport: () => { exports += 1; },
    onError: error => errors.push(error),
  });

  return {
    controller,
    button,
    ports,
    injections,
    scans,
    errors,
    get exports() { return exports; },
    set busy(value) { busy = value; },
    set disposed(value) { disposed = value; },
    set canExport(value) { canExport = value; },
    set throwOnPublish(value) { throwOnPublish = value; },
    set connectionTabId(value) { connectionTabId = value; },
    set query(value) { query = value; },
    set executeScript(value) { executeScript = value; },
    restore() { globalThis.chrome = previousChrome; },
    connect,
  };
}

test("接続は一度だけ許可したsession名と対象tabに限り受け付ける", async () => {
  const fixture = setup();
  try {
    const unknown = fixture.connect("harvest-collection:unknown", 7);
    assert.equal(unknown.disconnectCount, 0, "未許可名は旧経路と同じく無視する");

    fixture.connectionTabId = 99;
    await fixture.controller.toggle();
    const wrongTab = fixture.ports.at(-1);
    assert.equal(wrongTab.name, fixture.injections[0].args[0]);
    assert.equal(wrongTab.disconnectCount, 1);
    assert.equal(fixture.controller.session, wrongTab.name);

    fixture.controller.stop();
    fixture.connectionTabId = 7;
    fixture.button.click();
    for (let attempt = 0; attempt < 10 && fixture.ports.length < 3; attempt++)
      await new Promise(resolve => setImmediate(resolve));
    const accepted = fixture.ports.at(-1);
    assert.notEqual(accepted.name, wrongTab.name);
    assert.equal(accepted.disconnectCount, 0);
    assert.deepEqual(accepted.messages, [{busy: false, pdfUrl: null, canExport: true}]);
    assert.equal(fixture.button.attributes.get("aria-pressed"), "true");
    fixture.button.click();
    assert.equal(fixture.controller.session, null);
    assert.equal(fixture.button.attributes.get("aria-pressed"), "false");
  } finally {
    fixture.restore();
  }
});

test("busy・中断・古い接続は無視し、成功した同じURLは保存操作へ進む", async () => {
  const fixture = setup();
  try {
    await fixture.controller.toggle();
    const oldPort = fixture.ports.at(-1);
    const firstSession = fixture.controller.session;
    const url = "https://example.test/chapter/1";
    oldPort.send({url});
    assert.deepEqual(fixture.scans, [url]);

    fixture.busy = true;
    oldPort.send({url: "https://example.test/busy"});
    fixture.busy = false;
    oldPort.send({url: "mailto:reader@example.test"});
    fixture.disposed = true;
    oldPort.send({url: "https://example.test/disposed"});
    fixture.disposed = false;
    assert.deepEqual(fixture.scans, [url]);

    fixture.controller.markAnalyzedUrl(url, firstSession);
    fixture.controller.publishState();
    assert.deepEqual(oldPort.messages.at(-1), {busy: false, pdfUrl: url, canExport: true});
    oldPort.send({url});
    assert.equal(fixture.exports, 1);

    fixture.controller.stop();
    await fixture.controller.toggle();
    const newPort = fixture.ports.at(-1);
    const secondSession = fixture.controller.session;
    assert.notEqual(secondSession, firstSession);
    oldPort.send({url: "https://example.test/stale"});
    oldPort.disconnectFromPage();
    assert.equal(fixture.controller.session, secondSession, "古い切断通知は新しい収集を止めない");
    newPort.send({url: "https://example.test/current"});
    assert.deepEqual(fixture.scans, [url, "https://example.test/current"]);
  } finally {
    fixture.restore();
  }
});

test("状態通知に失敗した現在のPortだけを終了し、切断通知との二重終了を許容する", async () => {
  const fixture = setup();
  try {
    await fixture.controller.toggle();
    const failedPort = fixture.ports.at(-1);

    fixture.throwOnPublish = true;
    assert.doesNotThrow(() => fixture.controller.publishState());
    assert.equal(fixture.controller.session, null);
    assert.equal(fixture.button.textContent, "start");
    assert.equal(fixture.button.attributes.get("aria-pressed"), "false");

    fixture.controller.stop();
    failedPort.disconnectFromPage();
    fixture.throwOnPublish = false;
    await fixture.controller.toggle();
    const currentSession = fixture.controller.session;
    failedPort.disconnectFromPage();
    assert.equal(fixture.controller.session, currentSession, "古いPortの切断通知は新しい収集を止めない");
    fixture.ports.at(-1).send({url: "https://example.test/current"});
    assert.deepEqual(fixture.scans, ["https://example.test/current"]);
  } finally {
    fixture.restore();
  }
});

test("開始中に解除したsessionは遅れて返ったtabへ注入しない", async () => {
  const fixture = setup();
  let releaseQuery;
  fixture.query = () => new Promise(resolve => { releaseQuery = resolve; });
  try {
    const starting = fixture.controller.toggle();
    const session = fixture.controller.session;
    assert.ok(session);
    fixture.controller.stop();
    releaseQuery([{id: 7, url: "https://example.test/view"}]);
    await starting;
    assert.equal(fixture.injections.length, 0);
    assert.equal(fixture.controller.session, null);
    assert.equal(fixture.button.attributes.get("aria-pressed"), "false");
    const latePort = fixture.connect(session, 7);
    assert.equal(latePort.disconnectCount, 0, "注入前に停止したsessionは受付対象から除かれる");
  } finally {
    fixture.restore();
  }
});

test("注入前の開始失敗ではsessionを受付対象から除く", async () => {
  const fixture = setup();
  const failedSessions = [];
  fixture.query = async () => {
    failedSessions.push(fixture.controller.session);
    return [{id: 7, url: "chrome://settings"}];
  };
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await fixture.controller.toggle();
      assert.equal(fixture.controller.session, null);
    }
    assert.equal(fixture.injections.length, 0);
    assert.equal(fixture.errors.length, failedSessions.length);
    for (const session of failedSessions) {
      const latePort = fixture.connect(session, 7);
      assert.equal(latePort.disconnectCount, 0, "注入に到達しなかったsessionは受付対象から除かれる");
    }
  } finally {
    fixture.restore();
  }
});

test("新しい収集中に届いた古いsessionの遅延portは切断し、新しい処理を保つ", async () => {
  const fixture = setup();
  let releaseInjection;
  let oldSession;
  fixture.executeScript = injection => new Promise(resolve => {
    fixture.injections.push(injection);
    oldSession = injection.args[0];
    releaseInjection = () => {
      const port = fixture.connect(oldSession, 7);
      resolve([]);
      return port;
    };
  });
  try {
    const oldStart = fixture.controller.toggle();
    for (let attempt = 0; attempt < 10 && !releaseInjection; attempt++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof releaseInjection, "function");
    fixture.controller.stop();

    fixture.executeScript = async injection => {
      fixture.injections.push(injection);
      fixture.connect(injection.args[0], 7);
      return [];
    };
    await fixture.controller.toggle();
    const currentSession = fixture.controller.session;
    const newPort = fixture.ports.at(-1);
    const oldPort = releaseInjection();
    await oldStart;

    assert.equal(oldPort.disconnectCount, 1);
    assert.equal(fixture.controller.session, currentSession);
    newPort.send({url: "https://example.test/current"});
    assert.deepEqual(fixture.scans, ["https://example.test/current"]);
  } finally {
    fixture.restore();
  }
});

test("別のsession開始後でも注入済みsessionの遅延portを切断する", async () => {
  const fixture = setup();
  let finishOldInjection;
  let oldSession;
  fixture.executeScript = injection => new Promise(resolve => {
    fixture.injections.push(injection);
    oldSession = injection.args[0];
    finishOldInjection = () => resolve([]);
  });
  try {
    const oldStart = fixture.controller.toggle();
    for (let attempt = 0; attempt < 10 && !finishOldInjection; attempt++)
      await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof finishOldInjection, "function");
    fixture.controller.stop();

    fixture.executeScript = async injection => {
      fixture.injections.push(injection);
      fixture.connect(injection.args[0], 7);
      return [];
    };
    await fixture.controller.toggle();
    const currentSession = fixture.controller.session;
    const currentPort = fixture.ports.at(-1);
    finishOldInjection();
    await oldStart;

    const lateOldPort = fixture.connect(oldSession, 7);
    assert.equal(lateOldPort.disconnectCount, 1, "別session開始後も注入済みの古いsessionを拒否する");
    assert.equal(fixture.controller.session, currentSession);
    assert.equal(fixture.controller.session, currentPort.name);
  } finally {
    fixture.restore();
  }
});

test("停止した注入の遅い失敗と接続は新しい収集の解析済みURLを変えない", async () => {
  const fixture = setup();
  let failOldInjection;
  let oldSession;
  fixture.executeScript = injection => new Promise((_resolve, reject) => {
    oldSession = injection.args[0];
    failOldInjection = reject;
  });
  try {
    const oldStart = fixture.controller.toggle();
    for (let attempt = 0; attempt < 10 && !failOldInjection; attempt++) await Promise.resolve();
    assert.equal(typeof failOldInjection, "function");
    fixture.controller.stop();
    fixture.executeScript = async injection => {
      fixture.connect(injection.args[0], 7);
      return [];
    };
    await fixture.controller.toggle();
    const currentSession = fixture.controller.session;
    const currentPort = fixture.ports.at(-1);
    const url = "https://example.test/current";
    fixture.controller.markAnalyzedUrl(url, currentSession);

    failOldInjection(new Error("late failure"));
    await oldStart;
    assert.equal(fixture.connect(oldSession, 7).disconnectCount, 1);
    assert.equal(fixture.controller.session, currentSession);
    assert.equal(fixture.controller.analyzedUrl, url);
    assert.deepEqual(fixture.errors, []);
    currentPort.send({url});
    assert.equal(fixture.exports, 1);
  } finally {
    fixture.restore();
  }
});

test("sessionの接続許可は一度限りで、解析済みURLは現在のsessionにだけ属する", async () => {
  const fixture = setup();
  try {
    await fixture.controller.toggle();
    const session = fixture.controller.session;
    const port = fixture.ports.at(-1);
    const repeated = fixture.connect(session, 7);
    repeated.send({url: "https://example.test/repeated"});
    assert.equal(repeated.onMessageListener, undefined);
    assert.deepEqual(fixture.scans, []);

    const url = "https://example.test/chapter";
    fixture.controller.markAnalyzedUrl(url, session);
    assert.equal(fixture.controller.analyzedUrl, url);
    fixture.controller.clearAnalyzedUrl();
    fixture.controller.publishState();
    assert.equal(port.messages.at(-1).pdfUrl, null);
    fixture.controller.markAnalyzedUrl(url, session);
    fixture.controller.markAnalyzedUrl("https://example.test/stale", "previous-session");
    assert.equal(fixture.controller.analyzedUrl, url, "古いsessionの通知は現在の解析済みURLを消さない");
    fixture.controller.markAnalyzedUrl(url, session);
    fixture.controller.stop();
    assert.equal(fixture.controller.analyzedUrl, null);
    fixture.controller.markAnalyzedUrl(url, session);
    assert.equal(fixture.controller.analyzedUrl, null);
  } finally {
    fixture.restore();
  }
});

test("廃棄後は開始せず、開始済みの遅延接続も切断する", async () => {
  const fixture = setup();
  try {
    fixture.disposed = true;
    await fixture.controller.toggle();
    assert.equal(fixture.controller.session, null);
    assert.equal(fixture.injections.length, 0);
    fixture.disposed = false;
    fixture.executeScript = async injection => { fixture.injections.push(injection); return []; };
    await fixture.controller.toggle();
    const session = fixture.controller.session;
    fixture.disposed = true;
    const latePort = fixture.connect(session, 7);
    assert.equal(latePort.disconnectCount, 1);
    assert.deepEqual(latePort.messages, []);
  } finally {
    fixture.restore();
  }
});

test("受信値がnullや不正な型でも収集状態を壊さない", async () => {
  const fixture = setup();
  try {
    await fixture.controller.toggle();
    const port = fixture.ports.at(-1);
    for (const message of [null, undefined, 1, "url", {}, {url: false}]) {
      assert.doesNotThrow(() => port.send(message));
    }
    port.send({url: "https://example.test/current"});
    assert.deepEqual(fixture.scans, ["https://example.test/current"]);
  } finally {
    fixture.restore();
  }
});
