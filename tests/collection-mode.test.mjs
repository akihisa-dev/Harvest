import assert from "node:assert/strict";
import test from "node:test";
import {captureCollectionLinks} from "../dist/extension/app/collection-mode.js";

class Anchor {
  constructor(href) { this.href = href; this.nodeType = 1; this.tagName = "A"; }
  hasAttribute(name) { return name === "href"; }
  getAttribute(name) { return name === "href" ? this.href : null; }
}

function setup() {
  const listeners = new Set();
  const removed = [];
  const messages = [];
  let disconnected;
  const port = {
    postMessage(message) { messages.push(message); },
    onMessage: {addListener(listener) { port.messageListener = listener; }},
    onDisconnect: {addListener(listener) { disconnected = listener; }},
    messageListener: undefined,
  };
  const previous = {chrome: globalThis.chrome, document: globalThis.document, location: globalThis.location};
  globalThis.chrome = {runtime: {connect(options) { assert.deepEqual(options, {name: "test-session"}); return port; }}};
  globalThis.location = {href: "https://example.test/current"};
  globalThis.document = {
    baseURI: "https://example.test/current",
    addEventListener(type, listener, capture) { assert.equal(type, "click"); assert.equal(capture, true); listeners.add(listener); },
    removeEventListener(type, listener, capture) { removed.push({type, listener, capture}); listeners.delete(listener); },
  };
  return {
    port, messages, removed,
    click(anchor, options = {}) {
      let prevented = 0;
      let stopped = 0;
      const event = {
        button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...options,
        composedPath: () => [options.child ?? anchor, anchor],
        preventDefault() { prevented += 1; },
        stopImmediatePropagation() { stopped += 1; },
      };
      for (const listener of listeners) listener(event);
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
    assert.equal(fixture.removed.length, 1);
    assert.equal(fixture.removed[0].type, "click");
    assert.equal(fixture.removed[0].capture, true);
    assert.deepEqual(fixture.click(new Anchor("https://example.test/after")), {prevented: 0, stopped: 0});
    assert.deepEqual(fixture.messages, []);
  } finally { fixture.restore(); }
});
