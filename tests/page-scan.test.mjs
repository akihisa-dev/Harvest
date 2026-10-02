import assert from "node:assert/strict";
import test from "node:test";
import { scanDocument } from "../dist/extension/app/page-scan.js";
import { groupMediaImages } from "../dist/extension/core/images.js";

class FixtureElement {
  constructor(tagName, attributes = {}, children = [], properties = {}) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.namespaceURI = properties.namespaceURI ?? "http://www.w3.org/1999/xhtml";
    this.attributesMap = new Map(Object.entries(attributes));
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.shadowRoot = properties.shadowRoot ?? null;
    this.textContent = properties.textContent ?? "";
    this.currentSrc = properties.currentSrc;
    this.src = properties.src ?? this.attributesMap.get("src") ?? "";
    this.href = properties.href ?? this.attributesMap.get("href") ?? "";
    this.backgroundImage = properties.backgroundImage ?? "none";
    this.rect = properties.rect;
    this.display = properties.display;
    this.visibility = properties.visibility;
    for (const child of children) this.appendChild(child);
  }

  get childNodes() {
    return [...(this.textContent ? [{nodeType: 3, textContent: this.textContent, parentElement: this}] : []), ...this.children];
  }

  appendChild(child) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
  }

  getRootNode() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }

  contains(element) {
    return element === this || this.children.some(child => child.contains(element));
  }

  getAttribute(name) {
    return this.attributesMap.get(name) ?? null;
  }

  get attributes() {
    return [...this.attributesMap.entries()].map(([name, value]) => ({name, value}));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getBoundingClientRect() {
    if (!this.rect) return {top: 0, left: 0, width: 0, height: 0};
    return this.rect;
  }

  querySelectorAll(selector) {
    const wanted = selector.split(",").map(value => value.trim().toLowerCase());
    const result = [];
    const visit = element => {
      for (const child of element.children) {
        const tagName = child.tagName.toLowerCase();
        if (wanted.includes("*") || wanted.includes(tagName) || (wanted.includes("script") && tagName === "script") || (wanted.includes("style") && tagName === "style")) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
}

class FixtureShadowRoot {
  constructor(host, children = []) {
    this.host = host;
    this.nodeType = 11;
    this.children = [];
    this.parentNode = null;
    for (const child of children) this.appendChild(child);
  }

  get childNodes() {
    return [...(this.textContent ? [{nodeType: 3, textContent: this.textContent, parentElement: this}] : []), ...this.children];
  }

  appendChild(child) {
    child.parentElement = null;
    child.parentNode = this;
    this.children.push(child);
  }
}

class FixtureDocument {
  constructor(root, title = "Fixture", baseURI = "https://example.test/books/viewer") {
    this.documentElement = root;
    this.title = title;
    this.baseURI = baseURI;
    this.images = root.querySelectorAll("img");
  }

  querySelectorAll(selector) {
    return [this.documentElement, ...this.documentElement.querySelectorAll(selector)];
  }

  createTreeWalker(root) {
    const nodes = [];
    const visit = element => {
      if (element.textContent) nodes.push({textContent: element.textContent, parentElement: element});
      for (const child of element.children) visit(child);
    };
    visit(root);
    let index = 0;
    return {nextNode: () => nodes[index++] ?? null};
  }
}

async function runWithFixture(document, observerClass, callback) {
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
    getComputedStyle: globalThis.getComputedStyle,
    MutationObserver: globalThis.MutationObserver,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.document = document;
  globalThis.location = {href: "https://example.test/viewer"};
  globalThis.getComputedStyle = element => ({
    backgroundImage: element.backgroundImage,
    display: element.display,
    visibility: element.visibility,
  });
  globalThis.MutationObserver = observerClass;
  globalThis.setTimeout = callback => {
    callback();
    return 0;
  };
  globalThis.clearTimeout = () => {};
  try {
    return await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
}

test("期限切れでは部分結果を返さずMutationObserverを解放する", async () => {
  const root = new FixtureElement("html", {}, [new FixtureElement("img", {src: "https://cdn.example.test/pages/first.jpg"})]);
  let disconnected = false;
  let now = 0;
  class TrackingObserver {
    constructor() {}
    observe() {}
    disconnect() { disconnected = true; }
  }
  const document = new FixtureDocument(root);
  const previousPerformance = globalThis.performance;
  try {
    await runWithFixture(document, TrackingObserver, async () => {
      Object.defineProperty(globalThis, "performance", {
        configurable: true,
        value: {now: () => now},
      });
      const image = root.children[0];
      const getAttribute = image.getAttribute.bind(image);
      image.getAttribute = name => {
        now = 20_001;
        return getAttribute(name);
      };
      await assert.rejects(scanDocument(), /20 second deadline/);
    });
  } finally {
    Object.defineProperty(globalThis, "performance", {configurable: true, value: previousPerformance});
  }
  assert.equal(disconnected, true);
});

test("yieldから戻った時点で期限切れなら走査を終了する", async () => {
  const root = new FixtureElement("html", {}, Array.from({length: 251}, () => new FixtureElement("div")));
  let now = 0;
  const previousPerformance = globalThis.performance;
  try {
    await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, async () => {
      Object.defineProperty(globalThis, "performance", {configurable: true, value: {now: () => now}});
      globalThis.setTimeout = (callback, delay) => {
        if (delay === 800 || delay === 250) return 1;
        now = 20_001;
        callback();
        return 0;
      };
      await assert.rejects(scanDocument(), /20 second deadline/);
    });
  } finally {
    Object.defineProperty(globalThis, "performance", {configurable: true, value: previousPerformance});
  }
});

test("位置評価中の期限切れでは結果を返さず監視を解放する", async () => {
  const image = new FixtureElement("img", {src: "https://cdn.example.test/pages/position.jpg"}, [], {
    rect: {top: 1, left: 1, width: 10, height: 10},
  });
  const root = new FixtureElement("html", {}, [image]);
  let now = 0;
  let disconnected = false;
  class TrackingObserver extends EmptyMutationObserver { disconnect() { disconnected = true; } }
  const previousPerformance = globalThis.performance;
  try {
    await runWithFixture(new FixtureDocument(root), TrackingObserver, async () => {
      Object.defineProperty(globalThis, "performance", {configurable: true, value: {now: () => now}});
      globalThis.setTimeout = callback => { callback(); return 0; };
      image.getBoundingClientRect = () => { now = 20_001; return image.rect; };
      await assert.rejects(scanDocument(), /20 second deadline/);
    });
  } finally {
    Object.defineProperty(globalThis, "performance", {configurable: true, value: previousPerformance});
  }
  assert.equal(disconnected, true);
});

test("追加要素の走査期限切れをrejectし、次の走査は正常に完了する", async () => {
  const root = new FixtureElement("html");
  let observerCallback;
  let now = 0;
  let quietTimerCount = 0;
  const added = new FixtureElement("img", {src: "https://cdn.example.test/pages/added.jpg"});
  const getAttribute = added.getAttribute.bind(added);
  added.getAttribute = name => { now = 20_001; return getAttribute(name); };
  class TrackingObserver extends EmptyMutationObserver {
    constructor(callback) { super(); observerCallback = callback; }
  }
  const previousPerformance = globalThis.performance;
  try {
    const document = new FixtureDocument(root);
    await runWithFixture(document, TrackingObserver, async () => {
      Object.defineProperty(globalThis, "performance", {configurable: true, value: {now: () => now}});
      globalThis.setTimeout = (callback, delay) => {
        if (delay === 800) return 1;
        if (delay === 250 && quietTimerCount++ === 0) {
          root.appendChild(added);
          observerCallback([{type: "childList", addedNodes: [added]}]);
          return 1;
        }
        callback();
        return 0;
      };
      await assert.rejects(scanDocument(), /20 second deadline/);
      now = 0;
      added.getAttribute = getAttribute;
      globalThis.setTimeout = callback => { callback(); return 0; };
      assert.deepEqual((await scanDocument()).images, ["https://cdn.example.test/pages/added.jpg"]);
    });
  } finally {
    Object.defineProperty(globalThis, "performance", {configurable: true, value: previousPerformance});
  }
});

class EmptyMutationObserver {
  constructor() {}
  observe() {}
  disconnect() {}
}

test("videoのcurrentSrcでもsourceの音声指定を尊重し、種別変更後の古い動画根拠を除く", async () => {
  const url = "https://cdn.example.test/audio.mp4";
  const source = new FixtureElement("source", {src:url, type:"audio/mp4"});
  const video = new FixtureElement("video", {}, [source], {currentSrc:url});
  const root = new FixtureElement("html", {}, [video]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.media ?? [], []);
  source.attributesMap.set("type", "video/mp4");
  let notify, changed = false;
  class Observer extends EmptyMutationObserver { constructor(callback) { super(); notify = callback; } }
  const updated = await runWithFixture(new FixtureDocument(root), Observer, () => {
    globalThis.setTimeout = (callback, delay) => {
      if (delay === 800) return 0;
      if (delay === 250 && !changed) {
        changed = true;
        source.attributesMap.set("type", "audio/mp4");
        notify([{type:"attributes",target:source}]);
      }
      callback(); return 0;
    };
    return scanDocument();
  });
  assert.deepEqual(updated.media ?? [], []);
});

for (const scenario of ["slow", "small", "continuous"]) {
  test(`走査と待機の時計を制御して監視寿命を確認する: ${scenario}`, async () => {
    const before = new FixtureElement("img", {src:"https://cdn.example.test/before.jpg"});
    const removed = new FixtureElement("img", {src:"https://cdn.example.test/removed.jpg"});
    const root = new FixtureElement("html", {}, [before, removed,
      ...Array.from({length:scenario === "slow" ? 1000 : 0}, () => new FixtureElement("div"))]);
    let callback, connected = false, now = 0, nextId = 0;
    const timers = new Map();
    class Observer {
      constructor(fn) { callback = fn; }
      observe() { connected = true; }
      disconnect() { connected = false; }
    }
    const previousPerformance = globalThis.performance;
    try {
      await runWithFixture(new FixtureDocument(root), Observer, async () => {
        Object.defineProperty(globalThis, "performance", {configurable:true, value:{now:() => now}});
        globalThis.setTimeout = (fn, delay = 0) => { const id = ++nextId; timers.set(id, {fn, at:now + delay}); return id; };
        globalThis.clearTimeout = id => timers.delete(id);
        const advance = async target => {
          now = target;
          for (const [id, timer] of [...timers].sort((a,b) => a[1].at - b[1].at)) {
            if (timer.at <= now && timers.delete(id)) timer.fn();
          }
          for (let i = 0; i < 12; i++) await Promise.resolve();
        };
        let done = false;
        const scan = scanDocument().finally(() => { done = true; });
        if (scenario === "slow") {
          await advance(900);
          assert.equal(connected, true, "800msを過ぎても初回走査中は監視を切らない");
          before.src = "https://cdn.example.test/after.jpg";
          before.attributesMap.set("src", before.src);
          root.children = root.children.filter(node => node !== removed);
          removed.parentElement = removed.parentNode = null;
          const added = new FixtureElement("img", {src:"https://cdn.example.test/added.jpg"});
          root.appendChild(added);
          callback([{type:"attributes",target:before}, {type:"childList",addedNodes:[added],removedNodes:[removed]}]);
        } else {
          await advance(0);
        }
        if (scenario === "continuous") {
          for (let time = 100; time < 800; time += 100) {
            await advance(time);
            assert.equal(connected, true);
            before.src = `https://cdn.example.test/change-${time}.jpg`;
            before.attributesMap.set("src", before.src);
            callback([{type:"attributes", target:before}]);
          }
        }
        for (let i = 0; i < 100 && !done; i++) {
          const next = Math.min(...[...timers.values()].map(timer => timer.at));
          await advance(Number.isFinite(next) ? Math.max(now, next) : now);
        }
        assert.equal(done, true);
        const result = await scan;
        if (scenario === "slow") assert.deepEqual(result.images.sort(), ["https://cdn.example.test/after.jpg", "https://cdn.example.test/added.jpg"].sort());
        if (scenario === "small") assert.equal(now, 250, "小さいページは静穏250msで終わる");
        if (scenario === "continuous") {
          assert.equal(now, 800, "更新が続いても待機を800msで終える");
          assert.ok(result.images.includes("https://cdn.example.test/change-700.jpg"));
        }
        assert.equal(connected, false);
        assert.equal(timers.size, 0, "Observerと待機タイマーを解放する");
      });
    } finally { Object.defineProperty(globalThis, "performance", {configurable:true, value:previousPerformance}); }
  });
}

test("srcsetの最大指定、属性内URL、背景、meta、リンクを収集する", async () => {
  const image = new FixtureElement("img", {
    src: "https://cdn.example.test/pages/current.jpg",
    srcset: "https://cdn.example.test/pages/large.jpg 1280w, https://cdn.example.test/pages/small.jpg 320w",
  });
  const source = new FixtureElement("source", {
    srcset: "https://cdn.example.test/pages/retina-1.jpg 1x, https://cdn.example.test/pages/retina-2.jpg 2x",
  });
  const plainSource = new FixtureElement("source", {
    srcset: "https://cdn.example.test/pages/scan,page.jpg, https://cdn.example.test/pages/another.jpg",
  });
  const background = new FixtureElement("div", {}, [], {
    backgroundImage: 'url("https://cdn.example.test/pages/cover,name.jpg")',
  });
  const generic = new FixtureElement("div", {
    "data-image": "https://cdn.example.test/pages/generic.jpg",
  });
  const meta = new FixtureElement("meta", {
    property: "og:image",
    content: "https://cdn.example.test/pages/og.jpg",
  });
  const anchor = new FixtureElement("a", {
    href: "https://cdn.example.test/pages/link.webp",
  }, [], {href: "https://cdn.example.test/pages/link.webp"});
  const script = new FixtureElement("script", {}, [], {
    textContent: 'const image = "https://cdn.example.test/pages/script.avif?size=large";',
  });
  const root = new FixtureElement("html", {}, [image, source, plainSource, background, generic, meta, anchor, script]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  assert.equal(result.url, "https://example.test/viewer");
  assert.equal(result.title, "Fixture");
  assert.ok(result.images.includes("https://cdn.example.test/pages/large.jpg"));
  assert.ok(result.images.includes("https://cdn.example.test/pages/retina-2.jpg"));
  assert.ok(result.images.includes("https://cdn.example.test/pages/scan,page.jpg"));
  assert.ok(result.images.includes("https://cdn.example.test/pages/another.jpg"));
  assert.ok(result.images.includes("https://cdn.example.test/pages/cover,name.jpg"));
  assert.ok(result.images.includes("https://cdn.example.test/pages/generic.jpg"));
  assert.ok(result.images.includes("https://cdn.example.test/pages/og.jpg"));
  assert.ok(result.images.includes("https://cdn.example.test/pages/link.webp"));
  assert.ok(result.images.includes("https://cdn.example.test/pages/script.avif?size=large"));
  assert.equal(result.images.includes("https://cdn.example.test/pages/small.jpg"), false);
  assert.equal(new Set(result.images).size, result.images.length);
});

test("script・style・本文・汎用属性値にあるGIF URLを収集する", async () => {
  const script = new FixtureElement("script", {}, [], {
    textContent: 'const image = "https://cdn.example.test/pages/script.gif?size=large";',
  });
  const style = new FixtureElement("style", {}, [], {
    textContent: 'background-image: url("https://cdn.example.test/pages/style.gif");',
  });
  const paragraph = new FixtureElement("p", {}, [], {
    textContent: "https://cdn.example.test/pages/body.gif",
  });
  const generic = new FixtureElement("div", {
    "data-image": "https://cdn.example.test/pages/attribute.gif",
  });
  const image = new FixtureElement("img", {src: "https://cdn.example.test/pages/image.gif"});
  const anchor = new FixtureElement("a", {href: "https://cdn.example.test/pages/link.gif"}, [], {
    href: "https://cdn.example.test/pages/link.gif",
  });
  const root = new FixtureElement("html", {}, [script, style, paragraph, generic, image, anchor]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  for (const url of [
    "https://cdn.example.test/pages/script.gif?size=large",
    "https://cdn.example.test/pages/style.gif",
    "https://cdn.example.test/pages/body.gif",
    "https://cdn.example.test/pages/attribute.gif",
    "https://cdn.example.test/pages/image.gif",
    "https://cdn.example.test/pages/link.gif",
  ]) {
    assert.ok(result.images.includes(url), `missing ${url}`);
  }
});

test("非img要素の画像用途属性にある相対URLをページ基準で解決する", async () => {
  const lazy = new FixtureElement("div", {
    "data-src": "/pages/001.jpg?size=large",
    "data-url": "/api/preview.jpg",
    "aria-label": "/pages/decoration.jpg",
    "data-lazy-src": "/pages/unknown",
  });
  const image = new FixtureElement("img", {"data-src": "/pages/002.jpg"});
  const root = new FixtureElement("html", {}, [lazy, image]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  assert.deepEqual(result.images, [
    "https://example.test/pages/001.jpg?size=large",
    "https://example.test/pages/002.jpg",
  ]);
});

test("SVG imageのhrefとxlink:hrefをページ基準で収集し、表示位置で並べる", async () => {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const first = new FixtureElement("img", {src: "/pages/before.jpg"}, [], {
    rect: {top: 10, left: 0, width: 10, height: 10},
  });
  const relative = new FixtureElement("image", {href: "/pages/001.jpg"}, [], {
    namespaceURI: svgNamespace,
    rect: {top: 20, left: 0, width: 10, height: 10},
  });
  const xlink = new FixtureElement("image", {"xlink:href": "../pages/002.webp"}, [], {
    namespaceURI: svgNamespace,
    rect: {top: 30, left: 0, width: 10, height: 10},
  });
  const absolute = new FixtureElement("image", {href: "https://cdn.example.test/pages/003.png"}, [], {
    namespaceURI: svgNamespace,
    rect: {top: 40, left: 0, width: 10, height: 10},
  });
  const nonSvgImage = new FixtureElement("image", {href: "/pages/not-svg.jpg"});
  const ordinaryAnchor = new FixtureElement("a", {href: "/books/chapter/1"}, [], {
    href: "/books/chapter/1",
  });
  const root = new FixtureElement("html", {}, [first, relative, xlink, absolute, nonSvgImage, ordinaryAnchor]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  assert.deepEqual(result.images, [
    "https://example.test/pages/before.jpg",
    "https://example.test/pages/001.jpg",
    "https://example.test/pages/002.webp",
    "https://cdn.example.test/pages/003.png",
  ]);
  assert.equal(result.images.includes("https://example.test/books/chapter/1"), false);
});

test("open Shadow DOMを再帰走査し、画像・背景・本文URLを表示位置で収集する", async () => {
  const nestedImage = new FixtureElement("img", {src: "/shadow/nested.jpg"}, [], {
    rect: {top: 50, left: 0, width: 10, height: 10},
  });
  const nestedHost = new FixtureElement("nested-gallery");
  const nestedRoot = new FixtureShadowRoot(nestedHost, [nestedImage]);
  nestedHost.shadowRoot = nestedRoot;
  const image = new FixtureElement("img", {src: "/shadow/001.jpg"}, [], {
    rect: {top: 10, left: 0, width: 10, height: 10},
  });
  const source = new FixtureElement("source", {srcset: "/shadow/002.jpg 1x, /shadow/002-large.jpg 2x"}, [], {
    rect: {top: 20, left: 0, width: 10, height: 10},
  });
  const background = new FixtureElement("div", {}, [], {
    backgroundImage: 'url("/shadow/003.webp")',
    rect: {top: 30, left: 0, width: 10, height: 10},
  });
  const body = new FixtureElement("p", {}, [], {
    textContent: "https://cdn.example.test/shadow/body.gif",
    rect: {top: 40, left: 0, width: 10, height: 10},
  });
  const host = new FixtureElement("image-gallery");
  const shadowRoot = new FixtureShadowRoot(host, [image, source, background, body, nestedHost]);
  host.shadowRoot = shadowRoot;
  const closedHost = new FixtureElement("closed-gallery");
  closedHost.closedRoot = new FixtureShadowRoot(closedHost, [
    new FixtureElement("img", {src: "https://cdn.example.test/shadow/closed.jpg"}),
  ]);
  const root = new FixtureElement("html", {}, [host, closedHost]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  assert.deepEqual(result.images, [
    "https://example.test/shadow/001.jpg",
    "https://example.test/shadow/002-large.jpg",
    "https://example.test/shadow/003.webp",
    "https://example.test/shadow/nested.jpg",
    "https://cdn.example.test/shadow/body.gif",
  ]);
  assert.equal(result.images.some(url => url.includes("closed.jpg")), false);
});

test("open Shadow DOMの短時間内の追加・変更・削除を監視する", async () => {
  const base = "https://cdn.example.test/shadow/";
  const changedImage = new FixtureElement("img", {src: `${base}old.jpg`});
  const removedImage = new FixtureElement("img", {src: `${base}removed.jpg`});
  const host = new FixtureElement("image-gallery");
  const shadowRoot = new FixtureShadowRoot(host, [changedImage, removedImage]);
  host.shadowRoot = shadowRoot;
  const root = new FixtureElement("html", {}, [host]);
  const lateImage = new FixtureElement("img", {src: `${base}late.jpg`});
  let observerCallback;
  let observedTargets = [];
  let changed = false;
  class ShadowMutationObserver extends EmptyMutationObserver {
    constructor(callback) { super(); observerCallback = callback; }
    observe(target) { observedTargets.push(target); }
  }

  const result = await runWithFixture(new FixtureDocument(root), ShadowMutationObserver, () => {
    globalThis.setTimeout = (callback, delay) => {
      if (delay === 800) return 0;
      if (delay === 250 && !changed) {
        changed = true;
        changedImage.attributesMap.set("src", `${base}changed.jpg`);
        changedImage.src = `${base}changed.jpg`;
        shadowRoot.children = shadowRoot.children.filter(child => child !== removedImage);
        removedImage.parentElement = null;
        removedImage.parentNode = null;
        shadowRoot.appendChild(lateImage);
        observerCallback([
          {type: "attributes", target: changedImage},
          {type: "childList", addedNodes: [lateImage], removedNodes: [removedImage]},
        ]);
      }
      callback();
      return 0;
    };
    return scanDocument();
  });

  assert.ok(observedTargets.includes(shadowRoot));
  assert.ok(result.images.includes(`${base}changed.jpg`));
  assert.ok(result.images.includes(`${base}late.jpg`));
  assert.equal(result.images.includes(`${base}old.jpg`), false);
  assert.equal(result.images.includes(`${base}removed.jpg`), false);
});

test("srcsetの空白なし区切りとURL内のカンマを区別する", async () => {
  const root = new FixtureElement("html", {}, [
    new FixtureElement("source", {srcset: "small.jpg,large.jpg"}),
    new FixtureElement("source", {srcset: "spaced-small.jpg, spaced-large.jpg"}),
    new FixtureElement("source", {srcset: "density-small.jpg 1x,density-large.jpg 2x"}),
    new FixtureElement("source", {srcset: "/scan,page.jpg,/another.jpg"}),
    new FixtureElement("source", {srcset: "small.gif,large.gif"}),
    new FixtureElement("source", {srcset: "spaced-small.gif, spaced-large.gif"}),
    new FixtureElement("source", {srcset: "density-small.gif 1x,density-large.gif 2x"}),
    new FixtureElement("source", {srcset: "/scan,page.gif,/another.gif"}),
  ]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  assert.ok(result.images.includes("https://example.test/books/small.jpg"));
  assert.ok(result.images.includes("https://example.test/books/large.jpg"));
  assert.ok(result.images.includes("https://example.test/books/spaced-small.jpg"));
  assert.ok(result.images.includes("https://example.test/books/spaced-large.jpg"));
  assert.ok(result.images.includes("https://example.test/books/density-large.jpg"));
  assert.equal(result.images.includes("https://example.test/books/density-small.jpg"), false);
  assert.ok(result.images.includes("https://example.test/scan,page.jpg"));
  assert.ok(result.images.includes("https://example.test/another.jpg"));
  assert.equal(result.images.some(url => url.includes("small.jpg,large.jpg")), false);
  assert.ok(result.images.includes("https://example.test/books/small.gif"));
  assert.ok(result.images.includes("https://example.test/books/large.gif"));
  assert.ok(result.images.includes("https://example.test/books/spaced-small.gif"));
  assert.ok(result.images.includes("https://example.test/books/spaced-large.gif"));
  assert.ok(result.images.includes("https://example.test/books/density-large.gif"));
  assert.equal(result.images.includes("https://example.test/books/density-small.gif"), false);
  assert.ok(result.images.includes("https://example.test/scan,page.gif"));
  assert.ok(result.images.includes("https://example.test/another.gif"));
  assert.equal(result.images.some(url => url.includes("small.gif,large.gif")), false);
});

test("表示位置を優先し、meta先行の重複URLと位置のない候補を補正する", async () => {
  const topImage = new FixtureElement("img", {
    src: "https://cdn.example.test/pages/top.jpg",
  }, [], {rect: {top: 10, left: 20, width: 10, height: 10}});
  const leftImage = new FixtureElement("img", {
    src: "https://cdn.example.test/pages/left.jpg",
  }, [], {rect: {top: 10, left: 5, width: 10, height: 10}});
  const sharedMeta = new FixtureElement("meta", {
    property: "og:image",
    content: "https://cdn.example.test/pages/top.jpg",
  });
  const metadataOnly = new FixtureElement("meta", {
    property: "og:image",
    content: "https://cdn.example.test/pages/meta-only.jpg",
  });
  const root = new FixtureElement("html", {}, [sharedMeta, topImage, leftImage, metadataOnly]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  assert.deepEqual(result.images, [
    "https://cdn.example.test/pages/left.jpg",
    "https://cdn.example.test/pages/top.jpg",
    "https://cdn.example.test/pages/meta-only.jpg",
  ]);
});

test("非表示の要素を後置し、同じ画像は表示中の位置を使う", async () => {
  const url = "https://cdn.example.test/pages/shared.jpg";
  const hidden = new FixtureElement("img", {src: url}, [], {
    display: "none", rect: {top: 0, left: 0, width: 10, height: 10},
  });
  const visible = new FixtureElement("img", {src: url}, [], {
    rect: {top: 20, left: 0, width: 10, height: 10},
  });
  const first = new FixtureElement("img", {src: "https://cdn.example.test/pages/first.jpg"}, [], {
    rect: {top: 10, left: 0, width: 10, height: 10},
  });
  const hiddenOnly = new FixtureElement("img", {src: "https://cdn.example.test/pages/hidden.jpg"}, [], {
    display: "none", rect: {top: 0, left: 0, width: 10, height: 10},
  });
  const zeroSize = new FixtureElement("img", {src: "https://cdn.example.test/pages/zero.jpg"}, [], {
    rect: {top: 0, left: 0, width: 0, height: 0},
  });
  const samePosition = new FixtureElement("img", {src: "https://cdn.example.test/pages/same.jpg"}, [], {
    rect: {top: 0, left: 0, width: 10, height: 10},
  });
  const root = new FixtureElement("html", {}, [hidden, first, visible, hiddenOnly, zeroSize, samePosition]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());
  assert.deepEqual(result.images, [
    "https://cdn.example.test/pages/same.jpg",
    "https://cdn.example.test/pages/first.jpg", url,
    "https://cdn.example.test/pages/hidden.jpg",
    "https://cdn.example.test/pages/zero.jpg",
  ]);
});

test("短い監視時間内に追加された画像を収集する", async () => {
  const root = new FixtureElement("html");
  const initialImage = new FixtureElement("img", {src: "https://cdn.example.test/pages/initial.jpg"}, [], {
    rect: {top: 100, left: 0, width: 10, height: 10},
  });
  root.appendChild(initialImage);
  const lateImage = new FixtureElement("img", {src: "https://cdn.example.test/pages/late.jpg"});
  lateImage.rect = {top: 10, left: 0, width: 10, height: 10};
  let observer;
  class DelayedMutationObserver {
    constructor(callback) {
      observer = {callback};
    }
    observe() {}
    disconnect() {}
  }
  const document = new FixtureDocument(root);
  const result = await runWithFixture(document, DelayedMutationObserver, () => {
    globalThis.setTimeout = (callback, delay) => {
      if (delay === 800) {
        root.appendChild(lateImage);
        observer.callback([{type: "childList", addedNodes: [lateImage]}]);
      }
      callback();
      return 0;
    };
    return scanDocument();
  });
  assert.deepEqual(result.images, [
    "https://cdn.example.test/pages/late.jpg",
    "https://cdn.example.test/pages/initial.jpg",
  ]);
  assert.ok(result.images.includes("https://cdn.example.test/pages/late.jpg"));
});

test("短い監視時間内に追加されたscriptとstyleの本文URLを収集する", async () => {
  const root = new FixtureElement("html");
  const lateScript = new FixtureElement("script", {}, [], {
    textContent: 'const image = "https://cdn.example.test/pages/late-script.jpg";',
  });
  const lateStyle = new FixtureElement("style", {}, [], {
    textContent: 'background-image: url("https://cdn.example.test/pages/late-style.webp");',
  });
  let observer;
  class DelayedMutationObserver {
    constructor(callback) { observer = {callback}; }
    observe() {}
    disconnect() {}
  }
  const result = await runWithFixture(new FixtureDocument(root), DelayedMutationObserver, () => {
    globalThis.setTimeout = (callback, delay) => {
      if (delay === 800) {
        root.appendChild(lateScript);
        root.appendChild(lateStyle);
        observer.callback([{type: "childList", addedNodes: [lateScript, lateStyle]}]);
      }
      callback();
      return 0;
    };
    return scanDocument();
  });

  assert.ok(result.images.includes("https://cdn.example.test/pages/late-script.jpg"));
  assert.ok(result.images.includes("https://cdn.example.test/pages/late-style.webp"));
});

test("監視中に空の独自属性へ設定された画像URLを収集する", async () => {
  const base = "https://cdn.example.test/pages/";
  const lazy = new FixtureElement("div", {"data-zoom-image": ""});
  const root = new FixtureElement("html", {}, [lazy]);
  let observerCallback;
  let mutated = false;
  class ArbitraryAttributeObserver extends EmptyMutationObserver {
    constructor(callback) { super(); observerCallback = callback; }
  }

  const result = await runWithFixture(new FixtureDocument(root), ArbitraryAttributeObserver, () => {
    globalThis.setTimeout = (callback, delay) => {
      if (delay === 800) return 1;
      if (delay === 250 && !mutated) {
        mutated = true;
        lazy.attributesMap.set("data-zoom-image", `${base}001.jpg`);
        observerCallback([{type: "attributes", target: lazy, attributeName: "data-zoom-image"}]);
        return 2;
      }
      callback();
      return 3;
    };
    return scanDocument();
  });

  assert.deepEqual(result.images, [`${base}001.jpg`]);
});

test("属性の差し替え後は古い候補だけを除き、別の検出元の候補を残す", async () => {
  const base = "https://cdn.example.test/pages/";
  const image = new FixtureElement("img", {src: `${base}placeholder.jpg`});
  const srcset = new FixtureElement("source", {srcset: `${base}old-srcset.jpg 2x`});
  const lazy = new FixtureElement("img", {"data-src": `${base}old-lazy.jpg`});
  const shared = new FixtureElement("img", {src: `${base}shared.jpg`});
  const otherShared = new FixtureElement("img", {src: `${base}shared.jpg`});
  const text = new FixtureElement("script", {}, [], {
    textContent: `const cover = "${base}text-shared.jpg";`,
  });
  const textShared = new FixtureElement("img", {src: `${base}text-shared.jpg`});
  const root = new FixtureElement("html", {}, [image, srcset, lazy, shared, otherShared, text, textShared]);
  let observerCallback;
  let mutated = false;
  class ChangingObserver extends EmptyMutationObserver {
    constructor(callback) { super(); observerCallback = callback; }
  }

  const result = await runWithFixture(new FixtureDocument(root), ChangingObserver, () => {
    globalThis.setTimeout = (callback, delay) => {
      if (delay === 800) return 1;
      if (delay === 250 && !mutated) {
        mutated = true;
        image.attributesMap.set("src", `${base}page-001.jpg`);
        image.src = `${base}page-001.jpg`;
        srcset.attributesMap.set("srcset", `${base}new-srcset.jpg 2x`);
        lazy.attributesMap.set("data-src", `${base}new-lazy.jpg`);
        shared.attributesMap.set("src", `${base}new-shared.jpg`);
        shared.src = `${base}new-shared.jpg`;
        textShared.attributesMap.set("src", `${base}new-text.jpg`);
        textShared.src = `${base}new-text.jpg`;
        observerCallback([image, srcset, lazy, shared, textShared].map(target => ({type: "attributes", target})));
        return 2;
      }
      callback();
      return 3;
    };
    return scanDocument();
  });

  for (const name of ["placeholder", "old-srcset", "old-lazy"]) {
    assert.equal(result.images.includes(`${base}${name}.jpg`), false, name);
  }
  for (const name of ["page-001", "new-srcset", "new-lazy", "new-shared", "new-text", "shared", "text-shared"]) {
    assert.ok(result.images.includes(`${base}${name}.jpg`), name);
  }
});

test("削除された要素と子孫の候補を除き、現存する検出元と本文由来の候補を残す", async () => {
  const base = "https://cdn.example.test/pages/";
  const removedImage = new FixtureElement("img", {src: `${base}removed.jpg`});
  const removedChild = new FixtureElement("img", {src: `${base}child.jpg`});
  const removedParent = new FixtureElement("div", {}, [removedChild]);
  const sharedRemoved = new FixtureElement("img", {src: `${base}shared.jpg`});
  const sharedPresent = new FixtureElement("img", {src: `${base}shared.jpg`});
  const textRemoved = new FixtureElement("img", {src: `${base}text-shared.jpg`});
  const script = new FixtureElement("script", {}, [], {textContent: `const image = "${base}text-shared.jpg";`});
  const removedScript = new FixtureElement("script", {}, [], {textContent: `const image = "${base}removed-script.jpg";`});
  const removedStyle = new FixtureElement("style", {}, [], {textContent: `background: url("${base}removed-style.jpg")`});
  const moved = new FixtureElement("img", {src: `${base}moved.jpg`});
  const late = new FixtureElement("img", {src: `${base}late.jpg`});
  const root = new FixtureElement("html", {}, [removedImage, removedParent, sharedRemoved, sharedPresent, textRemoved, script, removedScript, removedStyle, moved]);
  let observerCallback;
  let mutated = false;
  class RemovingObserver extends EmptyMutationObserver {
    constructor(callback) { super(); observerCallback = callback; }
  }

  const result = await runWithFixture(new FixtureDocument(root), RemovingObserver, () => {
    globalThis.setTimeout = (callback, delay) => {
      if (delay === 800) return 1;
      if (delay === 250 && !mutated) {
        mutated = true;
        const removed = [removedImage, removedParent, sharedRemoved, textRemoved, removedScript, removedStyle, moved];
        root.children = root.children.filter(child => !removed.includes(child));
        for (const element of removed) element.parentElement = null;
        root.appendChild(moved);
        root.appendChild(late);
        observerCallback([{type: "childList", removedNodes: removed, addedNodes: [moved, late]}]);
        return 2;
      }
      callback();
      return 3;
    };
    return scanDocument();
  });

  for (const name of ["removed", "child", "removed-script", "removed-style"]) assert.equal(result.images.includes(`${base}${name}.jpg`), false, name);
  for (const name of ["shared", "text-shared", "moved", "late"]) {
    assert.ok(result.images.includes(`${base}${name}.jpg`), name);
  }
});

test("mediaは画像・GIF・直接MP4/WebMを形式別に返し、サムネイルやblobを動画にしない", async () => {
  const gifImage = new FixtureElement("img", {src: "https://cdn.example.test/media/animated?format=gif"});
  const thumbnail = new FixtureElement("img", {src: "https://cdn.example.test/media/poster.jpg"});
  const videoSource = new FixtureElement("source", {
    src: "https://cdn.example.test/media/movie.webm",
    type: "video/webm",
  });
  const video = new FixtureElement("video", {
    src: "blob:https://example.test/session-only",
    poster: "https://cdn.example.test/media/poster-only.mp4",
  }, [videoSource]);
  const standaloneSource = new FixtureElement("source", {src: "https://cdn.example.test/media/direct.mp4"});
  const root = new FixtureElement("html", {}, [gifImage, thumbnail, video, standaloneSource]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  assert.ok(result.images.includes("https://cdn.example.test/media/animated?format=gif"));
  assert.ok(result.images.includes("https://cdn.example.test/media/poster.jpg"));
  assert.equal(result.images.includes("https://cdn.example.test/media/movie.webm"), false);
  assert.equal(result.images.includes("https://cdn.example.test/media/direct.mp4"), false);
  assert.deepEqual(result.media, [
    {url: "https://cdn.example.test/media/animated?format=gif", kind: "gif"},
    {url: "https://cdn.example.test/media/poster.jpg", kind: "image"},
    {url: "https://cdn.example.test/media/movie.webm", kind: "video"},
    {url: "https://cdn.example.test/media/direct.mp4", kind: "video"},
  ]);
});

test("公開script JSONのvideo_infoから各動画の最高bitrate MP4だけを収集する", async () => {
  const json = {
    data: {
      media: [
        {
          type: "video",
          video_info: {variants: [
            {content_type: "application/x-mpegURL", bitrate: 2_000_000, url: "https://video.example.test/playlist.m3u8"},
            {content_type: "video/mp4", bitrate: 256_000, url: "https://video.example.test/low.mp4"},
            {content_type: "video/mp4; codecs=avc1", bitrate: 832_000, url: "https://video.example.test/high.mp4"},
          ]},
        },
        {
          type: "animated_gif",
          video_info: {variants: [
            {content_type: "video/mp4", bitrate: 0, url: "https://video.example.test/animated-gif.mp4"},
          ]},
        },
      ],
    },
  };
  const script = new FixtureElement("script", {}, [], {textContent: `window.__INITIAL_STATE__ = ${JSON.stringify(json)};`});
  const root = new FixtureElement("html", {}, [script]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  assert.deepEqual(result.media, [
    {url: "https://video.example.test/high.mp4", kind: "video"},
    {url: "https://video.example.test/animated-gif.mp4", kind: "video"},
  ]);
  assert.equal(result.media.some(candidate => candidate.url.endsWith("playlist.m3u8")), false);
  assert.equal(result.media.some(candidate => candidate.url.endsWith("low.mp4")), false);
});

test("GIF拡張子とformat=gifはscript・本文からもGIF候補として収集する", async () => {
  const script = new FixtureElement("script", {}, [], {
    textContent: 'const first = "https://cdn.example.test/media/script.gif?size=large"; const second = "https://cdn.example.test/media/format?format=gif";',
  });
  const paragraph = new FixtureElement("p", {}, [], {
    textContent: "https://cdn.example.test/media/body?format=gif",
  });
  const root = new FixtureElement("html", {}, [script, paragraph]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());

  assert.deepEqual(result.media, [
    {url: "https://cdn.example.test/media/script.gif?size=large", kind: "gif"},
    {url: "https://cdn.example.test/media/format?format=gif", kind: "gif"},
    {url: "https://cdn.example.test/media/body?format=gif", kind: "gif"},
  ]);
});

test("GIFの種類判定はグループ表示と同じ形式指定・大文字小文字・優先順位を使う", async () => {
  const cases = [
    ["animation.gif", "gif"], ["animation.GIF", "gif"],
    ["image?format=gif", "gif"], ["image?fmt=gif", "gif"], ["image?fm=gif", "gif"],
    ["image?FORMAT=GIF", "gif"], ["image?Fmt=GiF", "gif"], ["image?FM=GIF", "gif"],
    ["animation.jpg?fm=gif", "gif"], ["image?fm=x-gif", "gif"],
    ["animation.gif?fmt=png", "image"], ["image?fm=png&format=gif", "image"],
    ["image?format=&fmt=gif", "image"], ["image?format=gif&fm=png", "gif"],
    ["image?filename=gif", "image"], ["image?formatHint=gif", "image"],
    ["image?fmt=gif-preview", "image"], ["image?fm=image/gif", "image"],
  ].map(([path, kind]) => [`https://cdn.example.test/media/${path}`, kind]);
  const root = new FixtureElement("html", {}, cases.map(([src]) => new FixtureElement("img", {src})));
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());
  for (const [url, kind] of cases) {
    assert.equal(result.media.find(item => item.url === url)?.kind, kind, url);
    const [group] = Object.values(groupMediaImages([url]));
    assert.equal(group.label.startsWith("GIF ·"), kind === "gif", url);
  }
});

test("fmt・fmのGIF指定はscript・本文・属性からも収集する", async () => {
  const urls = ["script?fmt=gif", "body?FM=GIF", "attribute?Fmt=GiF"]
    .map(path => `https://cdn.example.test/media/${path}`);
  const root = new FixtureElement("html", {}, [
    new FixtureElement("script", {}, [], {textContent: `const animation = "${urls[0]}";`}),
    new FixtureElement("p", {}, [], {textContent: urls[1]}),
    new FixtureElement("div", {"data-media": urls[2]}),
  ]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());
  assert.deepEqual(new Set(result.media.map(item => item.url)), new Set(urls));
  assert.ok(result.media.every(item => item.kind === "gif"));
});

async function scanWithMutation(root, mutate) {
  let observerCallback;
  let mutated = false;
  class ChangingObserver extends EmptyMutationObserver {
    constructor(callback) { super(); observerCallback = callback; }
  }
  return runWithFixture(new FixtureDocument(root), ChangingObserver, () => {
    globalThis.setTimeout = (callback, delay) => {
      if (delay === 800) return 1;
      if (delay === 250 && !mutated) {
        mutated = true;
        observerCallback(mutate());
        return 2;
      }
      callback();
      return 3;
    };
    return scanDocument();
  });
}

test("同じ候補から画像は表示位置順、メディアは検出順で返し、GIFの種類を優先する", async () => {
  const base = "https://cdn.example.test/media/";
  const bottom = new FixtureElement("img", {src: `${base}bottom.jpg`}, [], {rect: {top: 100, left: 0, width: 10, height: 10}});
  const video = new FixtureElement("video", {src: `${base}movie.mp4`});
  const top = new FixtureElement("img", {src: `${base}top.jpg`}, [], {rect: {top: 0, left: 0, width: 10, height: 10}});
  const gifVideo = new FixtureElement("video", {src: `${base}animation.gif`, type: "video/mp4"});
  const gifImage = new FixtureElement("img", {src: `${base}animation.gif`});
  const unusable = new FixtureElement("img", {src: "mailto:unfetchable"});
  const root = new FixtureElement("html", {}, [bottom, video, top, gifVideo, gifImage, unusable]);
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());
  assert.deepEqual(result.images, [`${base}top.jpg`, `${base}bottom.jpg`, `${base}animation.gif`, "mailto:unfetchable"]);
  assert.deepEqual(result.media, [
    {url: `${base}bottom.jpg`, kind: "image"}, {url: `${base}movie.mp4`, kind: "video"},
    {url: `${base}top.jpg`, kind: "image"}, {url: `${base}animation.gif`, kind: "gif"},
  ]);
});

test("画像の根拠を差し替えても同じURLの動画を残し、最後のGIF根拠の削除を両方に反映する", async () => {
  const base = "https://cdn.example.test/media/";
  const image = new FixtureElement("img", {src: `${base}shared.mp4`});
  const video = new FixtureElement("video", {src: `${base}shared.mp4`});
  const keepGif = new FixtureElement("img", {src: `${base}keep.gif`});
  const removeGif = new FixtureElement("img", {src: `${base}removed.gif`});
  const root = new FixtureElement("html", {}, [image, video, keepGif, removeGif]);
  const result = await scanWithMutation(root, () => {
    image.attributesMap.set("src", `${base}replacement.jpg`);
    image.src = `${base}replacement.jpg`;
    root.children = root.children.filter(child => child !== removeGif);
    removeGif.parentElement = null;
    return [{type: "attributes", target: image}, {type: "childList", addedNodes: [], removedNodes: [removeGif]}];
  });
  assert.deepEqual(result.images, [`${base}keep.gif`, `${base}replacement.jpg`]);
  assert.deepEqual(result.media, [
    {url: `${base}shared.mp4`, kind: "video"}, {url: `${base}keep.gif`, kind: "gif"},
    {url: `${base}replacement.jpg`, kind: "image"},
  ]);
});

test("共有URLの一つの根拠を削除しても画像と確定済みのメディア種類・検出順を維持する", async () => {
  const base = "https://cdn.example.test/media/";
  const video = new FixtureElement("video", {src: `${base}shared`, type: "video/mp4"});
  const image = new FixtureElement("img", {src: `${base}shared`});
  const later = new FixtureElement("img", {src: `${base}later.jpg`});
  const root = new FixtureElement("html", {}, [video, image, later]);
  const result = await scanWithMutation(root, () => {
    root.children = root.children.filter(child => child !== video);
    video.parentElement = null;
    return [{type: "childList", addedNodes: [], removedNodes: [video]}];
  });
  assert.deepEqual(result.images, [`${base}shared`, `${base}later.jpg`]);
  assert.deepEqual(result.media, [{url: `${base}shared`, kind: "video"}, {url: `${base}later.jpg`, kind: "image"}]);
});

test("同じ要素とURLの画像根拠が動画へ変わると、後から再発見した画像だけ検出順を更新する", async () => {
  const base = "https://cdn.example.test/media/";
  const source = new FixtureElement("source", {src: `${base}shared`, type: "image/png"});
  const later = new FixtureElement("img", {src: `${base}later.jpg`});
  const rediscovered = new FixtureElement("img", {src: `${base}shared`});
  const root = new FixtureElement("html", {}, [source, later]);
  const result = await scanWithMutation(root, () => {
    source.attributesMap.set("type", "video/mp4");
    root.appendChild(rediscovered);
    return [{type: "attributes", target: source}, {type: "childList", addedNodes: [rediscovered], removedNodes: []}];
  });
  assert.deepEqual(result.images, [`${base}later.jpg`, `${base}shared`]);
  assert.deepEqual(result.media, [{url: `${base}shared`, kind: "video"}, {url: `${base}later.jpg`, kind: "image"}]);
});

test("背景の最終照合は未変更要素の本文・属性を再収集しない", async () => {
  const image = new FixtureElement("div", {"data-src": "https://cdn.example.test/attribute.jpg"}, [], {
    backgroundImage: 'url("https://cdn.example.test/stable.gif")',
    textContent: "https://cdn.example.test/text.jpg",
  });
  const root = new FixtureElement("html", {}, [image]);
  let attributeReads = 0;
  const getAttributes = Object.getOwnPropertyDescriptor(FixtureElement.prototype, "attributes").get;
  Object.defineProperty(image, "attributes", {get() { attributeReads += 1; return getAttributes.call(this); }});
  const result = await runWithFixture(new FixtureDocument(root), EmptyMutationObserver, () => scanDocument());
  assert.equal(attributeReads, 1);
  assert.deepEqual(new Set(result.images), new Set([
    "https://cdn.example.test/stable.gif", "https://cdn.example.test/text.jpg", "https://cdn.example.test/attribute.jpg",
  ]));
});

test("背景の最終照合中も20秒期限を確認し、部分結果を返さず監視を解放する", async () => {
  const image = new FixtureElement("div", {}, [], {backgroundImage: 'url("https://cdn.example.test/background.jpg")'});
  const root = new FixtureElement("html", {}, [image]);
  let now = 0;
  let backgroundReads = 0;
  let disconnected = false;
  class TrackingObserver extends EmptyMutationObserver { disconnect() { disconnected = true; } }
  const previousPerformance = globalThis.performance;
  try {
    await runWithFixture(new FixtureDocument(root), TrackingObserver, async () => {
      Object.defineProperty(globalThis, "performance", {configurable: true, value: {now: () => now}});
      globalThis.getComputedStyle = element => {
        if (element === image && ++backgroundReads === 2) now = 20_001;
        return {backgroundImage: element.backgroundImage};
      };
      await assert.rejects(scanDocument(), /20 second deadline/);
    });
  } finally {
    Object.defineProperty(globalThis, "performance", {configurable: true, value: previousPerformance});
  }
  assert.equal(backgroundReads, 2);
  assert.equal(disconnected, true);
});
