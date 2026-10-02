import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {chromium} from "playwright";
import {normalizeImageUrls} from "../dist/extension/core/images.js";

test("CSSのurl境界を読み、クエリ・括弧・エスケープを保って保存候補を重複させない", async () => {
  const source = await readFile(new URL("../dist/extension/app/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel:"chrome", headless:true});
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    for (const single of [true, false]) {
      await page.setContent('<base href="https://example.test/"><div class="page"></div>');
      const result = await page.evaluate(async ({source, single}) => {
        const moduleUrl = URL.createObjectURL(new Blob([source], {type:"text/javascript"}));
        const {scanDocument} = await import(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        const style = document.createElement("style");
        style.textContent = single ? '.page{width:100px;height:100px;background-image:url(https://cdn.example.test/single.jpg?v=1)}' : String.raw`
          .page {background-image:url(https://cdn.example.test/brace.jpg?v=1)}
          .absent {background:url(https://cdn.example.test/semicolon.jpg?v=1);}
          .multiple {background:url(https://cdn.example.test/first.jpg?v=1),url(https://cdn.example.test/second.jpg?v=2)}
          .quoted {background:url("https://cdn.example.test/quoted(1).jpg?q=(keep)")}
          .escaped {background:url(https://cdn.example.test/escaped\(1\).jpg?v=1)}
          .hex {background:url(https://cdn.example.test/hex\28 1\29 .jpg?v=1)}
          .plain {background:url('https://cdn.example.test/plain.jpg')}
          .encoded {background:url(https://cdn.example.test/encoded.jpg?q=%29%7D)}
          /* url(https://cdn.example.test/comment.jpg?v=1) */
          .text {content:"url(https://cdn.example.test/string.jpg?v=1)"}
          @font-face {font-family:test;src:url(https://cdn.example.test/font.woff2?v=1)}
        `;
        document.head.append(style);
        if (!single) {
          for (const name of ["multiple", "quoted", "escaped", "hex", "plain", "encoded"]) {
            const element = document.createElement("div"); element.className = name; document.body.append(element);
          }
          const inline = document.createElement("div");
          inline.setAttribute("style", "background:url(https://cdn.example.test/inline.jpg?v=1);width:10px;height:10px");
          document.body.append(inline);
        }
        return scanDocument();
      }, {source, single});
      const names = single ? ["single.jpg?v=1"] : ["brace.jpg?v=1", "semicolon.jpg?v=1", "first.jpg?v=1", "second.jpg?v=2", "quoted(1).jpg?q=(keep)", "escaped(1).jpg?v=1", "hex(1).jpg?v=1", "plain.jpg", "encoded.jpg?q=%29%7D", "inline.jpg?v=1"];
      const expected = names.map(name => `https://cdn.example.test/${name}`).sort();
      assert.deepEqual([...result.images].sort(), expected);
      assert.deepEqual(result.media.map(item => item.url).sort(), expected);
      assert.deepEqual(normalizeImageUrls([...result.images, ...result.media.map(item => item.url)], "https://example.test/").sort(), expected);
    }
  } finally { await browser.close(); }
});

test("初回走査中・待機中に既存ホストへ追加されたRootを発見し、削除・closedを除く", async () => {
  const source = await readFile(new URL("../dist/extension/app/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel:"chrome", headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="before"></div><div id="during"></div><div id="waiting"></div><div id="removed"></div><div id="closed"></div>');
    const result = await page.evaluate(async source => {
      const moduleUrl = URL.createObjectURL(new Blob([source], {type:"text/javascript"}));
      const {scanDocument} = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      document.body.append(...Array.from({length:300}, () => document.createElement("div")));
      const observations = new Map();
      const OriginalObserver = window.MutationObserver;
      window.MutationObserver = class extends OriginalObserver {
        observe(target, options) {
          observations.set(target, (observations.get(target) ?? 0) + 1);
          super.observe(target, options);
        }
      };
      const attach = (id, mode = "open") => {
        const shadow = document.getElementById(id).attachShadow({mode});
        const image = document.createElement("img");
        image.dataset.src = `https://cdn.example.test/${id}.jpg`;
        shadow.append(image);
        return shadow;
      };
      attach("before"); attach("removed"); attach("closed", "closed");
      setTimeout(() => attach("during"), 0);
      const scan = scanDocument();
      setTimeout(() => {
        const shadow = attach("waiting");
        const nestedHost = document.createElement("div");
        shadow.append(nestedHost);
        nestedHost.attachShadow({mode:"open"}).append(document.createTextNode("https://cdn.example.test/nested.gif"));
        document.getElementById("removed").remove();
      }, 20);
      const result = await scan;
      return {result, counts:[...observations.values()]};
    }, source);
    assert.deepEqual([...result.result.images].sort(), ["before.jpg", "during.jpg", "waiting.jpg", "nested.gif"].map(name => `https://cdn.example.test/${name}`).sort());
    assert.ok(result.counts.every(count => count === 1), "同じRootの監視登録を重ねない");
  } finally { await browser.close(); }
});

test("本文・script・styleとShadow DOMのText更新を所有要素へ反映する", async () => {
  const source = await readFile(new URL("../dist/extension/app/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<main></main><div id="host"></div>');
    const result = await page.evaluate(async source => {
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
      const {scanDocument} = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const roots = [document.querySelector("main"), document.querySelector("#host").attachShadow({mode: "open"})];
      const changes = [];
      roots.forEach((root, index) => {
        for (const [tag, method] of [["p", "data"], ["p", "nodeValue"], ["script", "textContent"], ["style", "data"], ["p", "remove"], ["p", "append"]]) {
          const element = document.createElement(tag);
          if (tag === "script") element.type = "application/json";
          const url = name => `https://cdn.example.test/${index}/${tag}-${method}-${name}.gif`;
          const content = name => tag === "style" ? `.absent {background: url("${url(name)}")}` : url(name);
          element.textContent = method === "append" ? "" : content("old");
          root.append(element);
          changes.push(() => {
            if (method === "textContent") element.textContent = content("new");
            else if (method === "append") element.append(document.createTextNode(content("new")));
            else if (method === "remove") element.firstChild.remove();
            else element.firstChild[method] = content("new");
          });
        }
        const shared = document.createElement("p");
        shared.textContent = `https://cdn.example.test/${index}/p-data-old.gif`;
        root.append(shared);
        const direct = document.createTextNode(`https://cdn.example.test/${index}/root-old.jpg`);
        root.append(direct);
        changes.push(() => { direct.data = `https://cdn.example.test/${index}/root-new.jpg`; });
      });
      const scan = scanDocument();
      setTimeout(() => changes.forEach(change => change()), 20);
      return scan;
    }, source);
    const expected = [0, 1].flatMap(index => ["p-data-new.gif", "p-data-old.gif", "p-nodeValue-new.gif", "script-textContent-new.gif", "style-data-new.gif", "p-append-new.gif", "root-new.jpg"].map(name => `https://cdn.example.test/${index}/${name}`));
    assert.deepEqual([...result.images].sort(), [...expected].sort());
    assert.deepEqual(result.media.map(({url}) => url).sort(), [...expected].sort());
  } finally { await browser.close(); }
});

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
