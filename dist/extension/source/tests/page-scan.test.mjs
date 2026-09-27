import assert from "node:assert/strict";
import test from "node:test";
import { scanDocument } from "../dist/extension/app/page-scan.js";

class FixtureElement {
  constructor(tagName, attributes = {}, children = [], properties = {}) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.attributesMap = new Map(Object.entries(attributes));
    this.children = [];
    this.parentElement = null;
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

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
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
      if (element.textContent) nodes.push({textContent: element.textContent});
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
  try {
    return await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
}

class EmptyMutationObserver {
  constructor() {}
  observe() {}
  disconnect() {}
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
