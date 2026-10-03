import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {chromium} from "playwright";
import {normalizeImageUrls} from "../dist/extension/core/images.js";
import {ImageCollection} from "../dist/extension/core/image-collection.js";

test("audioのsourceを収集せず、画像の初期選択とpicture・videoのsourceを保つ", async () => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    for (const mode of ["audio", "mixed", "video", "picture"]) {
      await page.setContent('<base href="https://example.test/"><main></main>');
      const result = await page.evaluate(async ({source, mode}) => {
        const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
        const {scanDocument} = await import(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        const main = document.querySelector("main");
        for (const [filename, type] of [
          ["music.mp3", "audio/mpeg"],
          ["music.ogg", "audio/ogg"],
          ["music.mp4", "audio/mp4"],
          ["unknown.mp4", ""],
          ["misleading.gif", "video/mp4"]
        ]) {
          const audio = document.createElement("audio");
          audio.preload = "none";
          const entry = document.createElement("source");
          entry.src = `https://cdn.example.test/${filename}`;
          entry.type = type;
          audio.append(entry);
          main.append(audio);
        }
        const audioSource = document.createElement("source");
        audioSource.src = "https://cdn.example.test/declared.mp4";
        audioSource.type = " AUDIO/mp4 ";
        main.append(audioSource);
        if (mode === "mixed") {
          const image = document.createElement("img");
          image.dataset.src = "https://cdn.example.test/image?id=1";
          main.append(image);
        }
        if (mode === "video") {
          const video = document.createElement("video");
          video.preload = "none";
          const entry = document.createElement("source");
          entry.src = "https://cdn.example.test/movie";
          entry.type = "video/mp4";
          video.append(entry);
          main.append(video);
        }
        if (mode === "picture") {
          const picture = document.createElement("picture");
          const entry = document.createElement("source");
          entry.srcset = "https://cdn.example.test/small 1x, https://cdn.example.test/large 2x";
          entry.type = "image/webp";
          picture.append(entry);
          main.append(picture);
        }
        return scanDocument();
      }, {source, mode});
      const expected = mode === "audio" ? [] : [`https://cdn.example.test/${{mixed: "image?id=1", video: "movie", picture: "large"}[mode]}`];
      assert.deepEqual(result.images, mode === "video" ? [] : expected, mode);
      assert.deepEqual((result.media ?? []).map(item => item.url), expected, mode);
      const collection = new ImageCollection();
      collection.replace(normalizeImageUrls([...result.images, ...(result.media ?? []).map(item => item.url)], "https://example.test/"), "https://example.test/", result.media);
      assert.deepEqual(collection.items.map(item => item.url), expected);
      assert.deepEqual(collection.selectedItems.map(item => item.url), expected);
    }
  } finally {
    await browser.close();
  }
});

test("CSSのurl境界を読み、クエリ・括弧・エスケープを保って保存候補を重複させない", async () => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    for (const single of [true, false]) {
      await page.setContent('<base href="https://example.test/"><div class="page"></div>');
      const result = await page.evaluate(async ({source, single}) => {
        const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
        const {scanDocument} = await import(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        const style = document.createElement("style");
        style.textContent = single
          ? '.page{width:100px;height:100px;background-image:url(https://cdn.example.test/single.jpg?v=1)}'
          : String.raw`
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
            const element = document.createElement("div");
            element.className = name;
            document.body.append(element);
          }
          const inline = document.createElement("div");
          inline.setAttribute("style", "background:url(https://cdn.example.test/inline.jpg?v=1);width:10px;height:10px");
          document.body.append(inline);
        }
        return scanDocument();
      }, {source, single});
      const names = single
        ? ["single.jpg?v=1"]
        : [
          "brace.jpg?v=1",
          "semicolon.jpg?v=1",
          "first.jpg?v=1",
          "second.jpg?v=2",
          "quoted(1).jpg?q=(keep)",
          "escaped(1).jpg?v=1",
          "hex(1).jpg?v=1",
          "plain.jpg",
          "encoded.jpg?q=%29%7D",
          "inline.jpg?v=1"
        ];
      const expected = names.map(name => `https://cdn.example.test/${name}`).sort();
      assert.deepEqual([...result.images].sort(), expected);
      assert.deepEqual(result.media.map(item => item.url).sort(), expected);
      assert.deepEqual(normalizeImageUrls([...result.images, ...result.media.map(item => item.url)], "https://example.test/").sort(), expected);
    }
  } finally {
    await browser.close();
  }
});

test("初回走査中・待機中に既存ホストへ追加されたRootを発見し、削除・closedを除く", async () => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="before"></div><div id="during"></div><div id="waiting"></div><div id="removed"></div><div id="closed"></div>');
    const result = await page.evaluate(async source => {
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
      const {scanDocument} = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      document.body.append(...Array.from({length: 300}, () => document.createElement("div")));
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
      attach("before");
      attach("removed");
      attach("closed", "closed");
      setTimeout(() => attach("during"), 0);
      const scan = scanDocument();
      setTimeout(() => {
        const shadow = attach("waiting");
        const nestedHost = document.createElement("div");
        shadow.append(nestedHost);
        nestedHost.attachShadow({mode: "open"}).append(document.createTextNode("https://cdn.example.test/nested.gif"));
        document.getElementById("removed").remove();
      }, 20);
      const result = await scan;
      return {result, counts: [...observations.values()]};
    }, source);
    assert.deepEqual([...result.result.images].sort(), ["before.jpg", "during.jpg", "waiting.jpg", "nested.gif"].map(name => `https://cdn.example.test/${name}`).sort());
    assert.ok(result.counts.every(count => count === 1), "同じRootの監視登録を重ねない");
  } finally {
    await browser.close();
  }
});

test("本文・script・styleとShadow DOMのText更新を所有要素へ反映する", async () => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
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
    const expected = [0, 1].flatMap(index => [
      "p-data-new.gif",
      "p-data-old.gif",
      "p-nodeValue-new.gif",
      "script-textContent-new.gif",
      "style-data-new.gif",
      "p-append-new.gif",
      "root-new.jpg"
    ].map(name => `https://cdn.example.test/${index}/${name}`));
    assert.deepEqual([...result.images].sort(), [...expected].sort());
    assert.deepEqual(result.media.map(({url}) => url).sort(), [...expected].sort());
  } finally {
    await browser.close();
  }
});

test("本文候補は属性更新で失われず、追加・削除と共有する根拠を反映する", async () => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
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
          else {
            p.className = "ready";
            p.setAttribute("aria-label", "ready");
          }
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
  } finally {
    await browser.close();
  }
});

test("実ブラウザーでopen Shadow DOMを再帰走査し、短時間の変更を反映する", async () => {
  const moduleSource = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
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


test("初回noneの背景をCSSOMで追加すると通常DOMとopen Shadow DOMから収集する", async () => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    for (const mode of ["style", "insert", "replace"]) {
      await page.setContent('<main></main><div id="host"></div>');
      const {result, initial, final} = await page.evaluate(async ({source, mode}) => {
        const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
        const {scanDocument} = await import(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        const roots = [document.querySelector("main"), document.querySelector("#host").attachShadow({mode: "open"})];
        const backgrounds = [];
        const changes = [];
        roots.forEach((root, index) => {
          const background = document.createElement("div");
          background.className = "page";
          root.append(background);
          backgrounds.push(background);
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(".page {width:10px;height:10px;background-image:none}");
          (index === 0 ? document : root).adoptedStyleSheets = [sheet];
          const value = `url("https://cdn.example.test/${index}/late?format=gif")`;
          changes.push(() => {
            if (mode === "style") sheet.cssRules[0].style.backgroundImage = value;
            else if (mode === "insert") sheet.insertRule(`.page {background-image:${value}}`, 1);
            else sheet.replaceSync(`.page {width:10px;height:10px;background-image:${value}}`);
          });
        });
        const initial = backgrounds.map(element => getComputedStyle(element).backgroundImage);
        const scan = scanDocument();
        setTimeout(() => changes.forEach(change => change()), 20);
        const result = await scan;
        const final = backgrounds.map(element => getComputedStyle(element).backgroundImage);
        return {result, initial, final};
      }, {source, mode});
      const expected = [0, 1].map(index => `https://cdn.example.test/${index}/late?format=gif`);
      assert.deepEqual(initial, ["none", "none"], mode);
      assert.deepEqual(final, expected.map(url => `url("${url}")`), mode);
      assert.deepEqual([...result.images].sort(), expected, mode);
      assert.deepEqual(result.media?.map(({url}) => url).sort(), expected, mode);
      assert.ok(result.media.every(({kind}) => kind === "gif"), mode);
    }
  } finally {
    await browser.close();
  }
});

test("結果確定前にCSS変更で消えた背景の根拠を更新し、共有URLと未適用CSSを保つ", async () => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    for (const mode of ["remove", "text", "cssom-change", "cssom-none", "shared"]) {
      await page.setContent('<main></main><div id="host"></div>');
      const result = await page.evaluate(async ({source, mode}) => {
        const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
        const {scanDocument} = await import(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        const roots = [document.querySelector("main"), document.querySelector("#host").attachShadow({mode: "open"})];
        const changes = [];
        roots.forEach((root, index) => {
          const oldUrl = `https://cdn.example.test/${index}/old.gif`;
          const newUrl = `https://cdn.example.test/${index}/new?format=gif`;
          const rule = url => `.page {background-image:url("${url}");width:10px;height:10px}`;
          const style = document.createElement("style");
          const background = document.createElement("div");
          background.className = "page";
          root.append(style, background);
          if (mode.startsWith("cssom")) {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(rule(oldUrl));
            const scope = index === 0 ? document : root;
            scope.adoptedStyleSheets = [sheet];
            changes.push(() => { sheet.cssRules[0].style.backgroundImage = mode === "cssom-none" ? "none" : `url("${newUrl}")`; });
          } else {
            style.textContent = rule(oldUrl);
            changes.push(() => {
              if (mode === "text") style.textContent = rule(newUrl);
              else style.remove();
            });
          }
          const unused = document.createElement("style");
          unused.textContent = `.absent {background:url("https://cdn.example.test/${index}/unused.jpg")}`;
          root.append(unused);
          if (mode === "shared") {
            const image = document.createElement("img");
            image.dataset.src = oldUrl;
            root.append(image, document.createTextNode(oldUrl));
          }
        });
        const scan = scanDocument();
        setTimeout(() => changes.forEach(change => change()), 20);
        return scan;
      }, {source, mode});
      const expected = [0, 1].flatMap(index => [
        `https://cdn.example.test/${index}/unused.jpg`,
        ...(["text", "cssom-change"].includes(mode) ? [`https://cdn.example.test/${index}/new?format=gif`] : []),
        ...(mode === "shared" ? [`https://cdn.example.test/${index}/old.gif`] : []),
      ]).sort();
      assert.deepEqual([...result.images].sort(), expected, mode);
      assert.deepEqual(result.media.map(({url}) => url).sort(), expected, mode);
      assert.ok(result.media.filter(({url}) => /old.gif|format=gif/.test(url)).every(({kind}) => kind === "gif"));
    }
  } finally {
    await browser.close();
  }
});

test("実Chromeの本文URLで句読点を除き、URL自身の括弧・クエリと最終拡張子を保持する", async () => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel:"chrome",headless:true});
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<base href="https://example.test/"><main></main>');
    const base = "https://cdn.example.test/";
    const cases = [
      [`(${base}photo.jpg)`, `${base}photo.jpg`],
      ...[",", ".", ";"].map(mark => [base + "photo.jpg" + mark, base + "photo.jpg"]),
      ...["photo(1).jpg", "(photo).jpg", "photo.jpg?token=(abc)", "photo.jpg?token=a,b", "photo.jpg#(preview)"].map(path => [base + path, base + path]),
      [`(${base}photo.jpg?token=abc)`, base + "photo.jpg?token=abc)"],
      [base + "photo.jpg.webp,", base + "photo.jpg.webp"],
      [base + "album.jpg/pages/001.png)", base + "album.jpg/pages/001.png"],
      [base + "photo.jpeg2000,", null], [base + "photo.jpg.txt)", null],
    ];
    const results = await page.evaluate(async ({source,cases}) => {
      const moduleUrl = URL.createObjectURL(new Blob([source], {type:"text/javascript"}));
      try {
        const {scanDocument} = await import(moduleUrl);
        const results = [];
        for (const [text] of cases) {
          document.querySelector("main").textContent = text;
          results.push((await scanDocument()).images);
        }
        return results;
      } finally {URL.revokeObjectURL(moduleUrl);}
    }, {source,cases});
    for (let index=0;index<cases.length;index++) {
      const [input,expected] = cases[index];
      assert.deepEqual(results[index], expected ? [expected] : [], input);
      assert.deepEqual(normalizeImageUrls(results[index],"https://example.test/"), expected ? [expected.split("#")[0]] : [], input);
    }
  } finally {await browser.close();}
});
