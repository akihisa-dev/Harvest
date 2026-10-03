import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {chromium} from "playwright";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extension = resolve(root, "dist/extension");

async function serve() {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      if (path === "/") {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><style>
          body {margin:0; min-height:1600px;} #outer {margin-top:80px; width:240px; height:300px; overflow:auto;}
          #spacer {height:60px;} #scroll {width:200px; height:360px; overflow:auto;}
          #images {display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); margin:0; padding:0; gap:0;}
          #images > li {height:100px; min-width:0; list-style:none;} .preview {display:none;}
          #all, #groups {display:none;}
        </style><button id="all"></button><div id="groups"></div>
        <div id="outer"><div id="spacer"></div><div id="scroll"><ol id="images"></ol></div></div>
        <script type="module">
          import {ImageCollection} from "/core/image-collection.js";
          import {createImageListView} from "/app/panel/image-list-view.js";
          const images = document.querySelector('#images');
          const collection = new ImageCollection();
          const urls = Array.from({length:60}, (_, i) => 'https://images.example.test/' + i + '.jpg');
          collection.replace(urls, 'https://images.example.test/');
          const view = createImageListView({collection, imagesElement:images,
            allVisibilityButton:document.querySelector('#all'), groupsElement:document.querySelector('#groups'),
            isBusy:() => false, getFilename:url => url.split('/').pop(),
            previewLoader:{set() {}, clearImage() {}}, onChange() { view.render(); }});
          view.showInitialGroup(null); view.render();
          const rows = [...images.children];
          const originalRect = HTMLElement.prototype.getBoundingClientRect;
          let measurements = 0;
          HTMLElement.prototype.getBoundingClientRect = function() {
            if (this.parentElement === images) measurements++;
            return originalRect.call(this);
          };
          const rect = row => originalRect.call(row);
          const visual = () => [...images.children].sort((a,b) => Number(a.style.order) - Number(b.style.order)).map(row => row.dataset.focusUrl);
          let source;
          let pointer;
          const event = (type, target, position = {}) => target.dispatchEvent(new DragEvent(type,
            {bubbles:true, cancelable:true, dataTransfer:new DataTransfer(), ...position}));
          const expectedAt = position => {
            const target = document.elementFromPoint(position.clientX, position.clientY)?.closest('#images > li');
            if (!target || target === source) return visual();
            const targetRect = rect(target);
            const single = rows.every(row => Math.abs(rect(row).left - rect(rows[0]).left) < 1);
            const after = single ? position.clientY >= targetRect.top + targetRect.height / 2
              : position.clientX >= targetRect.left + targetRect.width / 2;
            const expected = visual().filter(url => url !== source.dataset.focusUrl);
            expected.splice(expected.indexOf(target.dataset.focusUrl) + Number(after), 0, source.dataset.focusUrl);
            return expected;
          };
          window.fixture = {collection, urls, images, rows, view, visual, expectedAt,
            get measurements() { return measurements; }, resetMeasurements() { measurements = 0; },
            start(index = 0) { source = rows[index]; event('dragstart', source); },
            hover(index, after = true, throughList = false) {
              const r = rect(rows[index]);
              pointer = {clientX:r.left + r.width * (after ? .75 : .25), clientY:r.top + r.height * (after ? .75 : .25)};
              const expected = expectedAt(pointer);
              event('dragover', throughList ? images : rows[index], pointer);
              return {expected, preview:visual()};
            },
            repeat() { event('dragover', images, pointer); },
            scrollBy(top) {
              document.querySelector('#scroll').scrollTop += top;
              return expectedAt(pointer);
            },
            drop() { const preview = visual(); event('drop', images, pointer); return {preview, actual:collection.items.map(item => item.url)}; },
            cancel() { event('dragend', source); return {preview:visual(), actual:collection.items.map(item => item.url)}; },
          };
        </script>`);
        return;
      }
      if (path === "/app/panel/image-list-view.js") {
        const source = await readFile(resolve(root, "src/extension/panel/image-list-view.ts"), "utf8");
        const result = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}});
        response.setHeader("content-type", "text/javascript");
        response.end(result.outputText);
        return;
      }
      const target = resolve(extension, `.${path}`);
      if (!target.startsWith(`${extension}${sep}`)) throw new Error("outside extension");
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(target));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  return {server, url: `http://127.0.0.1:${server.address().port}/`};
}

for (const reducedMotion of ["reduce", "no-preference"])
  test(`ドラッグの挿入先はスクロール・列数変更へ追従し、全行の反復計測をしない (${reducedMotion})`, async () => {
    const {server, url} = await serve();
    let browser;
    try {
      browser = await chromium.launch({channel: "chrome", headless: true});
      const page = await browser.newPage({viewport: {width: 900, height: 700}, reducedMotion});
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const settle = () => page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
      });
      const reset = async () => {
        await page.goto(url);
        await page.waitForFunction(() => Boolean(window.fixture));
        await settle();
      };

      await reset();
      await page.evaluate(() => {
        fixture.start();
        document.querySelector('#scroll').scrollTop = 500;
        document.querySelector('#outer').scrollTop = 40;
        window.scrollTo(0, 40);
      });
      await settle();
      const nested = await page.evaluate(() => fixture.hover(6));
      assert.deepEqual(nested.preview, nested.expected, "行へ届いたdragoverでも、入れ子の領域と文書のスクロール後の位置を使う");
      const dropped = await page.evaluate(() => fixture.drop());
      assert.deepEqual(dropped.actual, dropped.preview, "表示した挿入順を確定する");
      assert.equal(dropped.actual.indexOf('https://images.example.test/0.jpg'), 6);

      await reset();
      await page.evaluate(() => {
        fixture.start();
        fixture.hover(0);
      });
      for (let step = 0; step < 4; step++) {
        const expected = await page.evaluate(() => fixture.scrollBy(100));
        await settle();
        assert.deepEqual(await page.evaluate(() => fixture.visual()), expected,
          "ポインターを動かさない自動スクロール相当の連続スクロールでも挿入位置を更新する");
      }
      const stable = await page.evaluate(() => {
        fixture.resetMeasurements();
        for (let i = 0; i < 100; i++) fixture.repeat();
        return fixture.measurements;
      });
      assert.equal(stable, 0, "レイアウトも挿入先も変わらないdragoverでは行を再計測しない");
      const cancelled = await page.evaluate(() => fixture.cancel());
      assert.deepEqual(cancelled.actual, await page.evaluate(() => fixture.urls));
      assert.deepEqual(cancelled.preview, cancelled.actual, "中止で実データと表示を元の順番へ戻す");
      assert.equal(await page.locator('#images').evaluate(element => element.style.overflowAnchor), "",
        "中止後はドラッグ前のスクロール設定へ戻す");
      await page.evaluate(() => {
        fixture.resetMeasurements();
        document.querySelector('#scroll').scrollTop += 100;
        window.dispatchEvent(new Event('resize'));
      });
      await settle();
      assert.equal(await page.evaluate(() => fixture.measurements), 0,
        "終了した操作のscroll/resize通知は行の計測を再開しない");
      assert.deepEqual(await page.evaluate(() => fixture.visual()), cancelled.actual);

      await reset();
      await page.evaluate(() => {
        fixture.start();
        document.querySelector('#outer').style.width = '700px';
        document.querySelector('#scroll').style.width = '640px';
      });
      await settle();
      const resized = await page.evaluate(() => fixture.hover(6, false, true));
      assert.deepEqual(resized.preview, resized.expected, "単列から複数列になった後は新しい横方向の境界を使う");
      const resizedDrop = await page.evaluate(() => fixture.drop());
      assert.deepEqual(resizedDrop.actual, resizedDrop.preview);
      assert.equal(resizedDrop.actual.indexOf('https://images.example.test/0.jpg'), 5);

      await reset();
      await page.evaluate(() => {
        document.querySelector('#outer').style.width = '700px';
        document.querySelector('#scroll').style.width = '640px';
      });
      await settle();
      await page.evaluate(() => {
        fixture.start();
        document.querySelector('#scroll').scrollTop = 200;
      });
      await settle();
      const gridScroll = await page.evaluate(() => fixture.hover(14, false, true));
      assert.deepEqual(gridScroll.preview, gridScroll.expected, "複数列でもスクロール後の行の左半分へ挿入する");
      const gridDrop = await page.evaluate(() => fixture.drop());
      assert.deepEqual(gridDrop.actual, gridDrop.preview);
      assert.equal(gridDrop.actual.indexOf('https://images.example.test/0.jpg'), 13);
      assert.equal(await page.locator('#images').evaluate(element => element.style.overflowAnchor), "",
        "確定後もドラッグ前のスクロール設定へ戻す");
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise(resolveClose => server.close(resolveClose));
    }
  });
