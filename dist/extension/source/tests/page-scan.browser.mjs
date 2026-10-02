import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {chromium} from "playwright";

test("本文候補は属性更新で失われず、追加・削除と共有する根拠を反映する", async () => {
  const source = await readFile(new URL("../dist/extension/app/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent('<main></main><div id="host"></div>');
    const result = await page.evaluate(async source => {
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
      const {scanDocument} = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const roots = [document.querySelector("main"), document.querySelector("#host").attachShadow({mode: "open"})];
      const paragraphs = [];
      roots.forEach((root, index) => {
        for (const name of ["stable.jpg", "stable.gif", "removed.jpg", "shared.gif"]) {
          const p = document.createElement("p");
          p.textContent = `https://cdn.example.test/${index}/${name}`;
          root.append(p);
          paragraphs.push(p);
        }
        root.append(root.lastChild.cloneNode(true));
      });
      const scan = scanDocument();
      setTimeout(() => {
        paragraphs.forEach(p => {
          if (/removed|shared/.test(p.textContent)) p.remove();
          else { p.className = "ready"; p.setAttribute("aria-label", "ready"); }
        });
        document.querySelector("main").className = "ready";
        roots.forEach((root, index) => {
          const p = document.createElement("p");
          p.textContent = `https://cdn.example.test/${index}/added.jpg`;
          root.append(p);
        });
      }, 20);
      return scan;
    }, source);
    const expected = [0, 1].flatMap(index => ["stable.jpg", "stable.gif", "shared.gif", "added.jpg"].map(name => `https://cdn.example.test/${index}/${name}`));
    assert.deepEqual([...result.images].sort(), [...expected].sort());
    assert.deepEqual(result.media.map(({url}) => url).sort(), [...expected].sort());
    assert.ok(result.media.filter(({url}) => url.endsWith(".gif")).every(({kind}) => kind === "gif"));
  } finally { await browser.close(); }
});

test("実ブラウザーでopen Shadow DOMを再帰走査し、短時間の変更を反映する", async () => {
  const moduleSource = await readFile(new URL("../dist/extension/app/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<base href="https://example.test/books/viewer"><div id="host"></div><div id="closed-host"></div>');
    const images = await page.evaluate(async source => {
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
      let scanDocument;
      try {
        ({scanDocument} = await import(moduleUrl));
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }

      const makeImage = src => {
        const image = document.createElement("img");
        image.src = src;
        image.style.width = "10px";
        image.style.height = "10px";
        return image;
      };
      const host = document.querySelector("#host");
      const shadow = host.attachShadow({mode: "open"});
      const changed = makeImage("/shadow/old.jpg");
      const removed = makeImage("/shadow/removed.jpg");
      const background = document.createElement("div");
      background.style.backgroundImage = "url('/shadow/background.webp')";
      const paragraph = document.createElement("p");
      paragraph.textContent = "https://cdn.example.test/shadow/body.gif";
      const nestedHost = document.createElement("nested-gallery");
      const nested = nestedHost.attachShadow({mode: "open"});
      nested.append(makeImage("/shadow/nested.png"));
      shadow.append(changed, removed, background, paragraph, nestedHost);

      const closedHost = document.querySelector("#closed-host");
      const closed = closedHost.attachShadow({mode: "closed"});
      closed.append(makeImage("/shadow/closed.jpg"));

      const scan = scanDocument();
      setTimeout(() => {
        changed.src = "/shadow/changed.jpg";
        removed.remove();
        shadow.append(makeImage("/shadow/late.avif"));
      }, 20);
      return (await scan).images;
    }, moduleSource);

    for (const url of [
      "https://example.test/shadow/background.webp",
      "https://cdn.example.test/shadow/body.gif",
      "https://example.test/shadow/nested.png",
      "https://example.test/shadow/changed.jpg",
      "https://example.test/shadow/late.avif",
    ]) {
      assert.ok(images.includes(url), url);
    }
    for (const path of ["old.jpg", "removed.jpg", "closed.jpg"]) {
      assert.equal(images.includes(`https://example.test/shadow/${path}`), false, path);
    }
  } finally {
    await browser.close();
  }
});
