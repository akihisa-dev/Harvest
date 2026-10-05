import test from "node:test";
import assert from "node:assert/strict";
import {serveExtension, extensionFile} from "./support/extension-files.mjs";
import {launchBrowser, startServer} from "./support/browser.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=", "base64");

for (const count of [200, 1000]) test(`selection and viewer navigation update only changed rows (${count})`, async t => {
  const {url} = await serveExtension(t);
  const browser = await launchBrowser(t);
  const page = await browser.newPage({viewport: {width: 1220, height: 800}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(count => {
    localStorage.setItem("harvest.includeSourcePage", "false");
    window.chrome = {
      runtime: {onConnect: {addListener() {}}}, i18n: {getUILanguage: () => "ja-JP"},
      tabs: {query: async () => [{id: 7, url: "https://source.example.test/gallery"}],
        get: async () => ({id: 7, url: "https://source.example.test/gallery"}), onRemoved: {addListener() {}, removeListener() {}}},
      scripting: {executeScript: async () => [{result: {images: Array.from({length: count}, (_, i) => `https://images.example.test/set/page-${i}.jpg`),
        url: "https://source.example.test/gallery", title: "DOM updates"}}]},
    };
  }, count);
  await page.route("https://images.example.test/**", route => route.fulfill({contentType: "image/png", body: png}));
  await page.goto(url);
  await page.locator("#scan").click();
  await page.waitForFunction(count => document.querySelector("#images").children.length === count, count);
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    window.changedRows = new Set(); window.changedThumbs = new Set(); window.reinsertions = 0;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        const row = element?.closest("#images > li"); if (row) window.changedRows.add(row);
        const thumb = element?.closest("#viewer-thumbnails > li"); if (thumb) window.changedThumbs.add(thumb);
        if (record.target.id === "viewer-thumbnails" && record.type === "childList") window.reinsertions++;
      }
    });
    observer.observe(document, {subtree: true, attributes: true, childList: true, characterData: true});
    window.resetUpdates = () => { window.changedRows.clear(); window.changedThumbs.clear(); window.reinsertions = 0; };
  });
  const first = page.locator("#images > li").first();
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => resetUpdates());
    await first.click();
    assert.equal(await first.getAttribute("aria-pressed"), String(i % 2 === 1));
    assert.equal(await first.evaluate(row => document.activeElement === row), true);
    assert.equal(await page.evaluate(() => changedRows.size), 1, "unchanged rows have no DOM mutation");
  }
  await page.locator("#viewer-toggle").click();
  await page.waitForTimeout(350);
  await page.locator("#viewer-next").click(); await page.waitForTimeout(350);
  await page.locator("#viewer-previous").click(); await page.waitForTimeout(350);
  const original = await page.locator("#viewer-position").textContent();
  for (const direction of ["next", "previous", "next", "previous"]) {
    await page.evaluate(() => resetUpdates());
    await page.locator(`#viewer-${direction}`).click();
    assert.equal(await page.evaluate(() => changedThumbs.size), 2, "only old/new active thumbnails change");
    assert.equal(await page.evaluate(() => reinsertions), 0);
    assert.equal(await page.locator(`#viewer-${direction}`).evaluate(button => button === document.activeElement), true);
    await page.waitForTimeout(350);
  }
  assert.equal(await page.locator("#viewer-position").textContent(), original);
  assert.deepEqual(errors, []);
});

test("row snapshots retain mutable metadata, busy, failed, order and preview changes", async t => {
  const server = await startServer(t, async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/test.html") {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><button id="all"></button><div id="groups"></div><ol id="images"></ol><script type="module">
        import {ImageCollection} from '/core/image-collection.js';
        import {createImageListView} from '/app/panel/image-list-view.js';
        const collection = new ImageCollection();
        collection.replace(['https://images.example.test/a.jpg','https://images.example.test/b.jpg'],'https://source.example.test/');
        let busy=false, filename='initial', sets=0;
        const view=createImageListView({collection,imagesElement:document.querySelector('#images'),groupsElement:document.querySelector('#groups'),allVisibilityButton:document.querySelector('#all'),isBusy:()=>busy,getFilename:()=>filename,previewLoader:{set(){sets++},clearImage(){}},onChange:()=>view.render()});
        view.showInitialGroup(null);view.render();
        window.fixture={collection,view,setBusy:v=>busy=v,setFilename:v=>filename=v,get sets(){return sets}};
      </script>`);
      return;
    }
    try { const file = await extensionFile(path); response.writeHead(200, {"content-type": file.contentType}); response.end(file.body); }
    catch { response.writeHead(404).end(); }
  });
  const browser = await launchBrowser(t); const page = await browser.newPage({reducedMotion: "reduce"});
  await page.goto(`http://127.0.0.1:${server.address().port}/test.html`);
  await page.waitForFunction(() => Boolean(window.fixture));
  const state = await page.evaluate(() => {
    const {collection, view} = fixture; const first=collection.items[0]; const row=document.querySelector('#images > li');
    const before=fixture.sets; view.render(); const unchanged=fixture.sets;
    fixture.setBusy(true); fixture.setFilename('changed'); first.kind='gif'; first.previewUrl='https://images.example.test/poster.gif';
    view.render(new Set([first]));
    const changed={busy:row.getAttribute('aria-disabled'),draggable:row.draggable,failed:row.classList.contains('failed'),name:row.querySelector('.item-title').textContent,label:row.getAttribute('aria-label'),sets:fixture.sets};
    first.sourcePage='https://source.example.test/changed'; view.render(new Set([first])); const sourceSets=fixture.sets;
    fixture.setBusy(false); first.kind='image'; delete first.previewUrl; collection.moveVisible(collection.items, first, collection.items[1]); view.render();
    return {before,unchanged,changed,sourceSets,final:{busy:row.getAttribute('aria-disabled'),failed:row.classList.contains('failed'),name:row.querySelector('.item-title').textContent,number:row.querySelector('.item-order').textContent},identity:[...document.querySelector('#images').children].includes(row)};
  });
  assert.equal(state.before, state.unchanged);
  assert.deepEqual(state.changed, {busy: "true", draggable: false, failed: true, name: "GIF · changed", label: "changed、1番目。取得失敗。クリックで保存対象を選択、ドラッグまたはAltと上下矢印で並べ替え", sets: 3});
  assert.equal(state.sourceSets, 4);
  assert.deepEqual(state.final, {busy: "false", failed: false, name: "changed", number: "2"});
  assert.equal(state.identity, true);
});
