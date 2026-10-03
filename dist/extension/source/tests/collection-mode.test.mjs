import assert from "node:assert/strict";
import test from "node:test";
import {captureCollectionLinks} from "../dist/extension/app/content/collection-mode.js";

class Anchor {
  constructor(href, style = makeStyle()) {
    this.href = href;
    this.nodeType = 1;
    this.tagName = "A";
    this.style = style;
    this.isConnected = true;
  }
  getBoundingClientRect() { return this.rect ?? {left: 10, top: 20, width: 100, height: 80}; }
  hasAttribute(name) { return name === "href"; }
  getAttribute(name) { return name === "href" ? this.href : null; }
  setAttribute(name, value) { if (name === "href") this.href = value; }
}

function makeStyle(initial = "", initialPriority = "") {
  const values = new Map(initial ? [["box-shadow", initial]] : []);
  const priorities = new Map(initial ? [["box-shadow", initialPriority]] : []);
  return {
    setProperty(name, value, priority = "") {
      values.set(name, value);
      priorities.set(name, priority);
      this[name.replaceAll("-", "")] = value;
    },
    getPropertyValue(name) { return values.get(name) ?? ""; },
    getPropertyPriority(name) { return priorities.get(name) ?? ""; },
    removeProperty(name) {
      const old = values.get(name) ?? "";
      values.delete(name);
      priorities.delete(name);
      delete this[name.replaceAll("-", "")];
      return old;
    },
  };
}

function setup() {
  const listeners = new Map();
  const glow = {style: makeStyle(), setAttribute() {}, remove() { this.removed = true; } };
  const overlays = [];
  let created = 0;
  const removed = [];
  const messages = [];
  let disconnected;
  let mutationObserver;
  let resizeObserver;
  let frameSequence = 0;
  const frames = new Map();
  let timerSequence = 0;
  const timers = new Map();
  const port = {
    postMessage(message) { messages.push(message); },
    onMessage: {addListener(listener) { port.messageListener = listener; } },
    onDisconnect: {addListener(listener) { disconnected = listener; } },
    messageListener: undefined,
  };
  const previous = {
    chrome: globalThis.chrome,
    document: globalThis.document,
    location: globalThis.location,
    window: globalThis.window,
    Element: globalThis.Element,
    MutationObserver: globalThis.MutationObserver,
    ResizeObserver: globalThis.ResizeObserver
  };
  globalThis.chrome = {
    runtime: {
      connect(options) {
        assert.deepEqual(options, {name: "test-session"});
        return port;
      }
    }
  };
  globalThis.Element = Anchor;
  globalThis.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      mutationObserver = this;
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    disconnect() { this.disconnected = true; }
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      resizeObserver = this;
    }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  const windowListeners = new Map();
  globalThis.window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener() {},
    requestAnimationFrame(callback) {
      const id = ++frameSequence;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) {
      const id = ++timerSequence;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.location = {href: "https://example.test/current"};
  globalThis.document = {
    createElement() {
      if (created++ === 0) return glow;
      const overlay = {style: makeStyle(), setAttribute() {}, remove() { this.removed = true; } };
      overlays.push(overlay);
      return overlay;
    },
    documentElement: {append(node) { node.appended = true; } },
    baseURI: "https://example.test/current",
    addEventListener(type, listener, capture) {
      assert.equal(capture, true);
      listeners.set(type, listener);
    },
    removeEventListener(type, listener, capture) {
      removed.push({type, listener, capture});
      listeners.delete(type);
    },
  };
  return {
    port,
    messages,
    removed,
    glow,
    overlays,
    removeFromPage(anchor) {
      anchor.isConnected = false;
      mutationObserver.callback([{type: "childList", target: document.documentElement, addedNodes: [], removedNodes: [anchor]}]);
    },
    changeHref(anchor, href) {
      anchor.setAttribute("href", href);
      mutationObserver.callback([{type: "attributes", target: anchor, attributeName: "href", addedNodes: [], removedNodes: []}]);
    },
    layoutChange(target) {
      mutationObserver.callback([{type: "attributes", target, attributeName: "class", addedNodes: [], removedNodes: []}]);
    },
    get observer() { return mutationObserver; },
    get resizeObserver() { return resizeObserver; },
    hover(anchor) {
      const event = {path: [anchor], composedPath() { return this.path; } };
      listeners.get("pointermove")?.(event);
      return event;
    },
    leave() { listeners.get("pointerout")?.(); },
    scroll() { listeners.get("scroll")?.(); },
    resize() { windowListeners.get("resize")?.(); },
    resizeObserved() { resizeObserver.callback([], resizeObserver); },
    flushAnimationFrame() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(0);
    },
    flushTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
    get pendingFrames() { return frames.size; },
    click(anchor, options = {}) {
      let prevented = 0;
      let stopped = 0;
      const event = {
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        isTrusted: true,
        ...options,
        composedPath: () => [options.child ?? anchor, anchor],
        preventDefault() { prevented += 1; },
        stopImmediatePropagation() { stopped += 1; },
      };
      listeners.get("click")?.(event);
      return {prevented, stopped};
    },
    disconnect() { disconnected(); },
    restore() { Object.assign(globalThis, previous); },
  };
}

test("通常の左クリックは遷移を止めて絶対URLを送る", async () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    assert.deepEqual(fixture.click(new Anchor("/picked")), {prevented: 1, stopped: 1});
    assert.deepEqual(fixture.messages, [{url: "https://example.test/picked"}]);
  } finally {
    fixture.restore();
  }
});

test("ページスクリプトが作った疑似クリックは止めずHarvestへ送らない", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    assert.deepEqual(fixture.click(new Anchor("/script"), {isTrusted: false}), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.messages, []);
  } finally {
    fixture.restore();
  }
});

test("修飾クリック・HTTP以外・hrefなしはそのまま通す", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    assert.deepEqual(fixture.click(new Anchor("https://example.test/a"), {ctrlKey: true}), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.click(new Anchor("mailto:user@example.test")), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.click(new Anchor("")), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.messages, []);
  } finally {
    fixture.restore();
  }
});

test("busy中も遷移を止めるが送信しない", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    fixture.port.messageListener({busy: true});
    assert.deepEqual(fixture.click(new Anchor("https://example.test/busy")), {prevented: 1, stopped: 1});
    assert.deepEqual(fixture.messages, []);
    fixture.port.messageListener({busy: false});
    fixture.click(new Anchor("https://example.test/ready"));
    assert.deepEqual(fixture.messages, [{url: "https://example.test/ready"}]);
  } finally {
    fixture.restore();
  }
});

test("切断後はリスナーを除去して遷移を復元する", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    fixture.disconnect();
    assert.deepEqual(fixture.removed.map(listener => listener.type).sort(),
      ["click", "pointermove", "pointerout", "scroll", "load", "transitionend", "animationend"].sort());
    assert.equal(fixture.glow.removed, true);
    assert.equal(fixture.observer.disconnected, true);
    assert.equal(fixture.removed[0].type, "click");
    assert.equal(fixture.removed[0].capture, true);
    assert.deepEqual(fixture.click(new Anchor("https://example.test/after")), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.messages, []);
  } finally {
    fixture.restore();
  }
});

test("収集できるリンクだけ文字なしで発光し、離脱・解析中・解除で消える", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    fixture.hover(new Anchor("/picked"));
    assert.equal(fixture.glow.style.display, "block");
    assert.equal(fixture.glow.style.width, "100px");
    assert.equal(fixture.glow.textContent, undefined);
    fixture.leave();
    assert.equal(fixture.glow.style.opacity, "0", "離脱時は不透明度を下げてから隠す");
    fixture.flushTimers();
    assert.equal(fixture.glow.style.display, "none");
    fixture.hover(new Anchor("mailto:user@example.test"));
    assert.equal(fixture.glow.style.display, "none");
    fixture.hover(new Anchor("/picked"));
    fixture.port.messageListener({busy: true});
    fixture.flushTimers();
    assert.equal(fixture.glow.style.display, "none");
    fixture.hover(new Anchor("/picked"));
    assert.equal(fixture.glow.style.display, "none");
    fixture.disconnect();
    assert.equal(fixture.glow.removed, true);
  } finally {
    fixture.restore();
  }
});

test("解析リンクは水色、PDF保存リンクだけ強い金色になり状態変更はその場で反映する", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    const picked = new Anchor("/picked");
    fixture.hover(picked);
    const scanGlow = fixture.glow.style.boxShadow;
    fixture.click(picked);
    fixture.port.messageListener({busy: true, pdfUrl: null, canExport: false});
    assert.equal(fixture.glow.style.opacity, "0");
    fixture.flushTimers();
    assert.equal(fixture.glow.style.display, "none");
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/picked", canExport: true});
    const pdfGlow = fixture.glow.style.boxShadow;
    assert.notEqual(pdfGlow, scanGlow);
    assert.ok(pdfGlow.includes("255,235,140"));
    assert.equal(fixture.glow.style.display, "block");
    fixture.hover(new Anchor("/different"));
    assert.equal(fixture.glow.style.boxShadow, scanGlow);
    fixture.hover(new Anchor("/picked"));
    assert.equal(fixture.glow.style.boxShadow, pdfGlow);
    fixture.port.messageListener({canExport: false});
    assert.equal(fixture.glow.style.boxShadow, scanGlow);
    fixture.port.messageListener({pdfUrl: null, canExport: true});
    assert.equal(fixture.glow.style.boxShadow, scanGlow);
  } finally {
    fixture.restore();
  }
});

test("成功したクリック対象だけが離脱・スクロール・サイズ変更後も発光し切断時に復元される", () => {
  const fixture = setup();
  const original = makeStyle("original-shadow", "important");
  const otherOriginal = makeStyle("other-shadow");
  const picked = new Anchor("/picked", original);
  const other = new Anchor("/other", otherOriginal);
  const failed = new Anchor("/failed");
  try {
    captureCollectionLinks("test-session");
    fixture.click(picked);
    fixture.click(other);
    fixture.click(failed);
    fixture.port.messageListener({busy: true, pdfUrl: "https://example.test/picked", canExport: true});
    assert.equal(original.getPropertyValue("box-shadow"), "original-shadow");
    fixture.port.messageListener({busy: false, pdfUrl: null, canExport: true});
    assert.equal(failed.style.getPropertyValue("box-shadow"), "");
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/picked", canExport: true});
    assert.equal(original.getPropertyValue("box-shadow"), "original-shadow");
    assert.ok(fixture.overlays[0].style.boxShadow.includes("255,235,140"));
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/other", canExport: true});
    assert.ok(fixture.overlays[0].style.boxShadow.includes("125,235,255"));
    assert.ok(fixture.overlays[1].style.boxShadow.includes("255,235,140"));
    fixture.leave();
    fixture.scroll();
    fixture.resize();
    assert.ok(fixture.overlays[0].style.boxShadow.includes("125,235,255"));
    assert.ok(fixture.overlays[1].style.boxShadow.includes("255,235,140"));
    fixture.disconnect();
    assert.equal(original.getPropertyValue("box-shadow"), "original-shadow");
    assert.equal(original.getPropertyPriority("box-shadow"), "important");
    assert.equal(otherOriginal.getPropertyValue("box-shadow"), "other-shadow");
    assert.equal(fixture.overlays[0].removed, true);
    assert.equal(fixture.overlays[1].removed, true);
  } finally {
    fixture.restore();
  }
});

test("DOMから消えた対象のマーカーと参照を片付け、残る対象の追従を保つ", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    assert.deepEqual(fixture.observer.options, {childList: true, subtree: true, attributes: true, characterData: true});
    const removed = new Anchor("/removed");
    const kept = new Anchor("/kept");
    fixture.click(removed);
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/removed", canExport: true});
    fixture.click(kept);
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/kept", canExport: true});
    assert.equal(fixture.overlays.length, 2);

    fixture.removeFromPage(removed);
    assert.equal(fixture.overlays[0].removed, true, "削除を検知して対応する表示を消す");
    assert.notEqual(fixture.overlays[1].removed, true);
    removed.isConnected = true;
    fixture.port.messageListener({pdfUrl: "https://example.test/removed"});
    assert.equal(fixture.overlays.length, 2, "古い解析済み参照から再作成しない");

    kept.rect = {left: 35, top: 40, width: 90, height: 70};
    fixture.scroll();
    fixture.flushAnimationFrame();
    fixture.resize();
    fixture.flushAnimationFrame();
    assert.equal(fixture.overlays[1].style.left, "35px");
    assert.equal(fixture.overlays[1].style.top, "40px");

    const pending = new Anchor("/pending");
    fixture.click(pending);
    fixture.removeFromPage(pending);
    pending.isConnected = true;
    fixture.port.messageListener({pdfUrl: "https://example.test/pending"});
    assert.equal(fixture.overlays.length, 2, "解析待ちの古い参照も再利用しない");

    fixture.click(removed);
    fixture.port.messageListener({pdfUrl: "https://example.test/removed"});
    assert.equal(fixture.overlays.length, 3, "再接続後の新しい操作はマークできる");
  } finally {
    fixture.restore();
  }
});

test("ページ内レイアウト変化を1フレームにまとめて保存表示とホバー表示へ反映する", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    const target = new Anchor("/moving");
    fixture.click(target);
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/moving", canExport: true});
    fixture.flushAnimationFrame();
    fixture.hover(target);
    assert.equal(fixture.overlays[0].style.top, "20px");
    assert.equal(fixture.glow.style.top, "20px");

    target.rect = {left: 45, top: 140, width: 120, height: 40};
    fixture.layoutChange(target);
    fixture.layoutChange(target);
    assert.equal(fixture.pendingFrames, 1, "複数のDOM変更を1フレームにまとめる");
    assert.equal(fixture.overlays[0].style.top, "20px", "DOM observer内では座標を同期計測しない");
    fixture.flushAnimationFrame();

    assert.equal(fixture.overlays[0].style.left, "45px");
    assert.equal(fixture.overlays[0].style.top, "140px");
    assert.equal(fixture.glow.style.left, "45px");
    assert.equal(fixture.glow.style.top, "140px");

    target.rect = {left: 60, top: 180, width: 140, height: 50};
    fixture.resizeObserved();
    assert.equal(fixture.pendingFrames, 1, "文書サイズ変化も描画待ちへまとめる");
    fixture.flushAnimationFrame();
    assert.equal(fixture.overlays[0].style.top, "180px");
    assert.equal(fixture.glow.style.top, "180px");
    fixture.disconnect();
    assert.equal(fixture.resizeObserver.disconnected, true);
  } finally {
    fixture.restore();
  }
});

test("href変更は古い解析表示と解析待ちを外し、同じURLのままなら表示を保つ", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    const analyzed = new Anchor("/analyzed");
    fixture.click(analyzed);
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/analyzed", canExport: true});
    assert.equal(fixture.overlays.length, 1);

    fixture.changeHref(analyzed, "https://example.test/analyzed");
    assert.notEqual(fixture.overlays[0].removed, true, "同じ解決URLでは解析表示を保つ");
    fixture.changeHref(analyzed, "/replacement");
    assert.equal(fixture.overlays[0].removed, true, "リンク先が変われば古い表示を消す");
    fixture.port.messageListener({pdfUrl: "https://example.test/analyzed"});
    assert.equal(fixture.overlays.length, 1, "古い解析結果を新しいリンクへ付けない");

    fixture.click(analyzed);
    analyzed.setAttribute("href", "/race-replacement");
    fixture.port.messageListener({pdfUrl: "https://example.test/replacement"});
    assert.equal(fixture.overlays.length, 1, "監視通知前でも現在のhrefと合わない解析結果を付けない");

    fixture.click(analyzed);
    fixture.port.messageListener({pdfUrl: "https://example.test/race-replacement"});
    assert.equal(fixture.overlays.length, 2, "変更後のURLをクリックした結果はマークできる");
  } finally {
    fixture.restore();
  }
});

test("メッセージ受信時は保存済みの対象を再描画する", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    const picked = new Anchor("/picked");
    const event = fixture.hover(picked);
    fixture.click(picked);
    event.path = [];
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/picked", canExport: true});
    assert.equal(fixture.glow.style.display, "block");
  } finally {
    fixture.restore();
  }
});

test("ブラウザーが影の色表記を正規化しても停止時に元へ戻す", () => {
  const fixture = setup();
  const style = makeStyle("0 1px 2px black", "important");
  const setProperty = style.setProperty;
  style.setProperty = function(name, value, priority) {
    setProperty.call(this, name, value.replaceAll(",", ", "), priority);
  };
  try {
    captureCollectionLinks("test-session");
    fixture.click(new Anchor("/picked", style));
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/picked", canExport: true});
    fixture.disconnect();
    assert.equal(style.getPropertyValue("box-shadow"), "0 1px 2px black");
    assert.equal(style.getPropertyPriority("box-shadow"), "important");
  } finally {
    fixture.restore();
  }
});

test("ホバーの残像は3個までで、終了・中止・切断で描画とアニメーションを解放する", () => {
  const fixture = setup();
  const previousStyle = globalThis.getComputedStyle;
  const animations = [];
  const animate = function() {
    const animation = {overlay: this, canceled: 0, cancel() { this.canceled++; this.oncancel?.(); }};
    animations.push(animation);
    return animation;
  };
  fixture.glow.animate = animate;
  fixture.glow.cloneNode = () => ({style: {...fixture.glow.style}, setAttribute() {}, animate,
    remove() { this.removed = true; }});
  globalThis.getComputedStyle = element => ({opacity: element.style.opacity, transform: element.style.transform});
  try {
    captureCollectionLinks("test-session");
    fixture.glow.style.display = "none";
    const targets = Array.from({length: 5}, (_, index) => new Anchor(`/hover-${index}`));
    for (const target of targets) fixture.hover(target);
    assert.equal(animations.length, 4);
    assert.equal(animations[0].canceled, 1);
    assert.equal(animations[0].overlay.removed, true);
    assert.equal(animations.filter(animation => !animation.overlay.removed).length, 3);
    animations[1].onfinish();
    assert.equal(animations[1].overlay.removed, true);
    fixture.click(targets[4]);
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/hover-4", canExport: true});
    assert.equal(fixture.pendingFrames, 1);
    fixture.disconnect();
    assert.equal(fixture.pendingFrames, 0);
    assert.deepEqual(animations.slice(0, 4).map(animation => animation.canceled), [1, 0, 1, 1]);
    assert.equal(animations.slice(0, 4).every(animation => animation.overlay.removed), true);
    assert.equal(animations.at(-1).overlay, fixture.glow, "切断後の通常の消灯効果を保つ");
    animations.at(-1).onfinish();
    assert.equal(fixture.glow.removed, true);
  } finally {
    globalThis.getComputedStyle = previousStyle;
    fixture.restore();
  }
});
