import assert from "node:assert/strict";
import test from "node:test";
import {captureCollectionLinks} from "../dist/extension/app/collection-mode.js";

class Anchor {
  constructor(href, style = makeStyle()) { this.href = href; this.nodeType = 1; this.tagName = "A"; this.style = style; }
  getBoundingClientRect() { return {left: 10, top: 20, width: 100, height: 80}; }
  hasAttribute(name) { return name === "href"; }
  getAttribute(name) { return name === "href" ? this.href : null; }
}

function makeStyle(initial = "", initialPriority = "") {
  const values = new Map(initial ? [["box-shadow", initial]] : []);
  const priorities = new Map(initial ? [["box-shadow", initialPriority]] : []);
  return {
    setProperty(name, value, priority = "") { values.set(name, value); priorities.set(name, priority); this[name.replaceAll("-", "")] = value; },
    getPropertyValue(name) { return values.get(name) ?? ""; },
    getPropertyPriority(name) { return priorities.get(name) ?? ""; },
    removeProperty(name) { const old = values.get(name) ?? ""; values.delete(name); priorities.delete(name); delete this[name.replaceAll("-", "")]; return old; },
  };
}

function setup() {
  const listeners = new Map();
  const glow = {style: makeStyle(), setAttribute() {}, remove() { this.removed = true; }};
  const removed = [];
  const messages = [];
  let disconnected;
  const port = {
    postMessage(message) { messages.push(message); },
    onMessage: {addListener(listener) { port.messageListener = listener; }},
    onDisconnect: {addListener(listener) { disconnected = listener; }},
    messageListener: undefined,
  };
  const previous = {chrome: globalThis.chrome, document: globalThis.document, location: globalThis.location, window: globalThis.window, Element: globalThis.Element};
  globalThis.chrome = {runtime: {connect(options) { assert.deepEqual(options, {name: "test-session"}); return port; }}};
  globalThis.Element = Anchor;
  const windowListeners = new Map();
  globalThis.window = {addEventListener(type, listener) { windowListeners.set(type, listener); }, removeEventListener() {}};
  globalThis.location = {href: "https://example.test/current"};
  globalThis.document = {
    createElement() { return glow; },
    documentElement: {append() {}},
    baseURI: "https://example.test/current",
    addEventListener(type, listener, capture) { assert.equal(capture, true); listeners.set(type, listener); },
    removeEventListener(type, listener, capture) { removed.push({type, listener, capture}); listeners.delete(type); },
  };
  return {
    port, messages, removed, glow,
    hover(anchor) {
      const event = {path: [anchor], composedPath() { return this.path; }};
      listeners.get("pointermove")?.(event);
      return event;
    },
    leave() { listeners.get("pointerout")?.(); },
    scroll() { listeners.get("scroll")?.(); },
    resize() { windowListeners.get("resize")?.(); },
    click(anchor, options = {}) {
      let prevented = 0;
      let stopped = 0;
      const event = {
        button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...options,
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
  } finally { fixture.restore(); }
});

test("修飾クリック・HTTP以外・hrefなしはそのまま通す", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    assert.deepEqual(fixture.click(new Anchor("https://example.test/a"), {ctrlKey: true}), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.click(new Anchor("mailto:user@example.test")), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.click(new Anchor("")), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.messages, []);
  } finally { fixture.restore(); }
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
  } finally { fixture.restore(); }
});

test("切断後はリスナーを除去して遷移を復元する", () => {
  const fixture = setup();
  try {
    captureCollectionLinks("test-session");
    fixture.disconnect();
    assert.equal(fixture.removed.length, 4);
    assert.equal(fixture.glow.removed, true);
    assert.equal(fixture.removed[0].type, "click");
    assert.equal(fixture.removed[0].capture, true);
    assert.deepEqual(fixture.click(new Anchor("https://example.test/after")), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.messages, []);
  } finally { fixture.restore(); }
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
    assert.equal(fixture.glow.style.display, "none");
    fixture.hover(new Anchor("mailto:user@example.test"));
    assert.equal(fixture.glow.style.display, "none");
    fixture.hover(new Anchor("/picked"));
    fixture.port.messageListener({busy: true});
    assert.equal(fixture.glow.style.display, "none");
    fixture.hover(new Anchor("/picked"));
    assert.equal(fixture.glow.style.display, "none");
    fixture.disconnect();
    assert.equal(fixture.glow.removed, true);
  } finally { fixture.restore(); }
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
  } finally { fixture.restore(); }
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
    assert.ok(original.getPropertyValue("box-shadow").includes("255,235,140"));
    fixture.port.messageListener({busy: false, pdfUrl: "https://example.test/other", canExport: true});
    assert.ok(original.getPropertyValue("box-shadow").includes("125,235,255"));
    assert.ok(otherOriginal.getPropertyValue("box-shadow").includes("255,235,140"));
    fixture.leave();
    fixture.scroll();
    fixture.resize();
    assert.ok(original.getPropertyValue("box-shadow").includes("125,235,255"));
    assert.ok(otherOriginal.getPropertyValue("box-shadow").includes("255,235,140"));
    fixture.disconnect();
    assert.equal(original.getPropertyValue("box-shadow"), "original-shadow");
    assert.equal(original.getPropertyPriority("box-shadow"), "important");
    assert.equal(otherOriginal.getPropertyValue("box-shadow"), "other-shadow");
  } finally { fixture.restore(); }
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
  } finally { fixture.restore(); }
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
  } finally { fixture.restore(); }
});
