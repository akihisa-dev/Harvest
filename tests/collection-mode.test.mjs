import assert from "node:assert/strict";
import test from "node:test";
import {captureCollectionLinks} from "../dist/extension/app/collection-mode.js";

class Anchor {
  constructor(href) { this.href = href; this.nodeType = 1; this.tagName = "A"; }
  getBoundingClientRect() { return {left: 10, top: 20, width: 100, height: 80}; }
  hasAttribute(name) { return name === "href"; }
  getAttribute(name) { return name === "href" ? this.href : null; }
}

function setup() {
  const listeners = new Map();
  const glow = {style: {}, setAttribute() {}, remove() { this.removed = true; }};
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
  globalThis.window = {addEventListener() {}, removeEventListener() {}};
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
    hover(anchor) { listeners.get("pointermove")?.({composedPath: () => [anchor]}); },
    leave() { listeners.get("pointerout")?.(); },
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
    fixture.hover(new Anchor("/picked"));
    const scanGlow = fixture.glow.style.boxShadow;
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
