import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {launchBrowser} from "./support/browser.mjs";

const image = name => `https://cdn.example.test/pages/${name}.png`;

test("外部CSSの生成・表示された前後の疑似要素を収集し、重複と非表示を除く", async t => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await launchBrowser(t), page = await browser.newPage();
  const active = (selector, name) => `${selector}{content:"";display:block;width:20px;height:20px;background-image:url("${image(name)}")}`;
  const css = active(".before::before", "before") + active(".after::after", "after")
    + active(".shared::before", "shared") + `.shared{background-image:url("${image("shared")}")}`
    + active(".none::before", "none") + '.none::before{content:none}'
    + active(".normal::before", "normal") + '.normal::before{content:normal}'
    + active(".hidden::before", "hidden") + '.hidden::before{display:none}'
    + active(".invisible::before", "invisible") + '.invisible::before{visibility:hidden}'
    + active(".transparent::before", "transparent") + '.transparent::before{opacity:0}'
    + active(".ancestor::before", "ancestor") + '.hidden-parent{display:none}'
    + active(".faded::before", "faded") + '.faded-parent{opacity:0}'
    + active(".contents::before", "contents") + '.contents{display:contents}'
    + active(".override::before", "override") + '.override{visibility:hidden}.override::before{visibility:visible}'
    + active(".shadow::after", "shadow");
  await page.route("https://**/*", route => {
    const url = route.request().url();
    if (url.endsWith("/sheet.css")) return route.fulfill({contentType: "text/css", body: css});
    if (url === "https://reader.test/") return route.fulfill({contentType: "text/html", body: '<!doctype html><link rel="stylesheet" href="https://styles.test/sheet.css">'
      + ['before', 'after', 'shared', 'none', 'normal', 'hidden', 'invisible', 'transparent', 'contents', 'override'].map(name => `<div class="${name}"></div>`).join('')
      + `<img src="${image('shared')}"><div class="hidden-parent"><div class="ancestor"></div></div><div class="faded-parent"><div class="faded"></div></div><div id="host"></div>`});
    return route.abort();
  });
  await page.goto("https://reader.test/");
  const result = await page.evaluate(async source => {
    let protectedCss = false;
    try { void document.styleSheets[0].cssRules; } catch { protectedCss = true; }
    const shadow = document.querySelector("#host").attachShadow({mode: "open"});
    const sheet = document.createElement("link"); sheet.rel = "stylesheet"; sheet.href = "https://styles.test/sheet.css";
    const loaded = new Promise(resolve => sheet.onload = resolve);
    shadow.append(sheet, Object.assign(document.createElement("div"), {className: "shadow"}));
    await loaded;
    const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
    try { const {scanDocument} = await import(moduleUrl); return {scan: await scanDocument(), protectedCss}; }
    finally { URL.revokeObjectURL(moduleUrl); }
  }, source);
  assert.equal(result.protectedCss, true, "CSS本文を読めない別オリジンのスタイルを使う");
  const expected = ['before', 'after', 'shared', 'contents', 'override', 'shadow'].map(image).sort();
  assert.deepEqual([...result.scan.images].sort(), expected);
  assert.deepEqual(result.scan.media.map(item => item.url).sort(), expected);
});

test("疑似要素のCSSOM変更・削除で古い根拠を除き、共有URLと遅れて表示された背景を保つ", async t => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await launchBrowser(t), page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  await page.setContent('<base href="https://reader.test/"><main></main><div id="host"></div>');
  const result = await page.evaluate(async source => {
    const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
    const {scanDocument} = await import(moduleUrl); URL.revokeObjectURL(moduleUrl);
    const roots = [document.querySelector("main"), document.querySelector("#host").attachShadow({mode: "open"})];
    const changes = [];
    roots.forEach((root, index) => {
      const sheet = new CSSStyleSheet();
      const names = ['changed', 'removed', 'shared', 'hidden', 'late'];
      const owners = names.map(name => Object.assign(document.createElement('div'), {className: name}));
      root.append(...owners);
      sheet.replaceSync(names.map(name => `.${name}::${index ? 'after' : 'before'}{content:"";display:block;width:10px;height:10px;background-image:${name === 'late' ? 'none' : `url("https://cdn.example.test/${index}/${name}-old.png")`}}`).join(''));
      (index ? root : document).adoptedStyleSheets = [sheet];
      const shared = document.createElement('img'); shared.src = `https://cdn.example.test/${index}/shared-old.png`; root.append(shared);
      changes.push(() => {
        sheet.cssRules[0].style.backgroundImage = `url("https://cdn.example.test/${index}/changed-new.png")`;
        owners[1].remove();
        sheet.cssRules[2].style.content = 'none';
        sheet.cssRules[3].style.content = 'none';
        sheet.cssRules[4].style.backgroundImage = `url("https://cdn.example.test/${index}/late-new.png")`;
      });
    });
    const work = scanDocument();
    setTimeout(() => changes.forEach(change => change()), 20);
    return work;
  }, source);
  const expected = [0, 1].flatMap(index => ['changed-new', 'shared-old', 'late-new'].map(name => `https://cdn.example.test/${index}/${name}.png`)).sort();
  assert.deepEqual([...result.images].sort(), expected);
  assert.deepEqual(result.media.map(item => item.url).sort(), expected);
});

test("5000要素の疑似要素走査は重複をまとめ、分割処理と20秒期限内の完了を維持する", {timeout: 25000}, async t => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await launchBrowser(t), page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  await page.setContent('<base href="https://reader.test/"><main></main>');
  const result = await page.evaluate(async source => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.card::before{content:"";display:block;width:1px;height:1px;background-image:url("https://cdn.example.test/pages/shared.png")}');
    document.adoptedStyleSheets = [sheet];
    const owners = new Set(Array.from({length: 5000}, () => Object.assign(document.createElement('div'), {className: 'card'})));
    document.querySelector('main').append(...owners);
    const original = window.getComputedStyle;
    let pseudoReads = 0, ticks = 0;
    window.getComputedStyle = (element, pseudo) => { if (owners.has(element) && pseudo) pseudoReads++; return original(element, pseudo); };
    const timer = setInterval(() => ticks++, 1);
    const moduleUrl = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    try {
      const {scanDocument} = await import(moduleUrl), start = performance.now();
      const scan = await scanDocument();
      return {scan, elapsed: performance.now() - start, pseudoReads, ticks};
    } finally { clearInterval(timer); window.getComputedStyle = original; URL.revokeObjectURL(moduleUrl); }
  }, source);
  assert.deepEqual(result.scan.images, [image('shared')]);
  assert.equal(result.pseudoReads, 4 * 5000, "各疑似要素を初回と最終の各1回だけ照合する");
  assert.ok(result.ticks > 0, "走査中もイベント処理へ制御を返す");
  assert.ok(result.elapsed < 20000);
  t.diagnostic(`5000要素: ${Math.round(result.elapsed)} ms、疑似要素の参照 ${result.pseudoReads} 回`);
});


test("疑似要素のcontent画像は外部CSSから収集し、文字列・非表示・削除済みURLを除く", async t => {
  const source = await readFile(new URL("../dist/extension/app/content/page-scan.js", import.meta.url), "utf8");
  const browser = await launchBrowser(t), page = await browser.newPage();
  await page.route("https://**/*", route => {
    const url = route.request().url();
    if (url.endsWith('/sheet.css')) return route.fulfill({contentType: 'text/css', body:
      ['before', 'after', 'shared', 'hidden', 'transparent', 'changed', 'removed'].map(name => `.${name}::${name === 'after' ? 'after' : 'before'}{content:url("${image(name)}");display:block}`).join('')
      + `.shared{background-image:url("${image('shared')}")}.hidden::before{display:none}.transparent::before{opacity:0}.text::before{content:'url("${image('text')}")'}`});
    if (url === 'https://reader.test/') return route.fulfill({contentType: 'text/html', body: '<link rel="stylesheet" href="https://styles.test/sheet.css">'
      + ['before', 'after', 'shared', 'hidden', 'transparent', 'text', 'changed', 'removed'].map(name => `<div class="${name}"></div>`).join('')});
    return route.abort();
  });
  await page.goto('https://reader.test/');
  const result = await page.evaluate(async source => {
    const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    try {
      const {scanDocument} = await import(url);
      const work = scanDocument();
      setTimeout(() => {
        const sheet = document.createElement('style');
        sheet.textContent = '.changed::before{content:url("https://cdn.example.test/pages/new.png")}.removed::before{content:none}';
        document.head.append(sheet);
      }, 20);
      return await work;
    } finally { URL.revokeObjectURL(url); }
  }, source);
  assert.deepEqual([...result.images].sort(), ['before', 'after', 'shared', 'new'].map(image).sort());
});
