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
  globalThis.getComputedStyle = element => ({backgroundImage: element.backgroundImage});
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

test("短い監視時間内に追加された画像を収集する", async () => {
  const root = new FixtureElement("html");
  const lateImage = new FixtureElement("img", {src: "https://cdn.example.test/pages/late.jpg"});
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
  assert.ok(result.images.includes("https://cdn.example.test/pages/late.jpg"));
});
