import {extensionFile} from "./support/extension-files.mjs";
import {startServer, launchBrowser} from "./support/browser.mjs";
import assert from "node:assert/strict";
import test from "node:test";

async function serve(t) {
  const server = await startServer(t, async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/test.html") {
        response.writeHead(200, {"content-type": "text/html"});
        response.end(`<!doctype html><html><head><style>
          #images {display:flex; flex-direction:column; gap:4px; width:240px;}
          #images > li {height:60px; width:240px; border:1px solid black;}
        </style></head><body><button id="all"></button><div id="groups"></div><ol id="images"></ol>
          <script type="module">
            import {ImageCollection} from "/core/image-collection.js";
            import {createImageListView} from "/app/panel/image-list-view.js";
            const collection = new ImageCollection();
            const urls = ["https://images.example.test/1.jpg", "https://images.example.test/2.jpg"];
            collection.replace(urls, "https://images.example.test/");
            const imagesElement = document.querySelector("#images");
            const previewLoader = {set(image, item) { image.dataset.url = item.url; }, clearImage(image) { delete image.dataset.url; }};
            const view = createImageListView({
              collection, allVisibilityButton: document.querySelector("#all"),
              groupsElement: document.querySelector("#groups"), imagesElement, isBusy: () => false,
              getFilename: url => url.split("/").pop(), previewLoader, onChange() {},
            });
            const source = {url: "data:image/svg+xml,source-preview", selected: false};
            const animations = [];
            Element.prototype.animate = function(keyframes, options) {
              animations.push({className: this.className, keyframes, options});
              return {finished: Promise.resolve(), cancel() {}};
            };
            let rowMeasurements = 0;
            const originalRect = HTMLElement.prototype.getBoundingClientRect;
            HTMLElement.prototype.getBoundingClientRect = function() {
              if (this.parentElement === imagesElement) rowMeasurements += 1;
              return originalRect.call(this);
            };
            window.__fixture = {collection, urls, view, source, imagesElement, animations,
              get rowMeasurements() { return rowMeasurements; }};
            view.showInitialGroup(null);
            view.render();
          </script>
        </body></html>`);
        return;
      }
      const file = await extensionFile(pathname);
      response.writeHead(200, {"content-type": file.contentType});
      response.end(file.body);
    } catch {
      if (!response.headersSent) response.writeHead(404).end();
    }
  });

  return {server, url: `http://127.0.0.1:${server.address().port}/test.html`};
}

test("Source row entry and removal animate while selection updates reuse layout", async (t) => {
  const {server, url} = await serve(t);
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__fixture));
  const baseline = await page.evaluate(() => {
    const fixture = window.__fixture;
    fixture.images = [...fixture.imagesElement.children];
    fixture.collection.toggleSelected(fixture.urls[0]);
    fixture.view.render();
    const afterSelection = fixture.rowMeasurements;
    fixture.view.render(new Set(), fixture.source);
    const afterSourceEntry = fixture.rowMeasurements;
    fixture.collection.toggleSelected(fixture.urls[1]);
    fixture.view.render(new Set(), fixture.source);
    const afterStableRender = fixture.rowMeasurements;
    const sourceEntryAnimated = fixture.animations.some(animation => animation.className === "source-preview");
    fixture.view.render(new Set(), null);
    return {
      afterSelection,
      afterSourceEntry,
      afterStableRender,
      afterSourceRemoved: fixture.imagesElement.children.length,
      imagesRetained: fixture.images.every((row, index) => fixture.imagesElement.children[index] === row),
      sourceEntryAnimated,
      sourceGhostAnimated: fixture.animations.some(animation => animation.className.includes("motion-ghost"))
    };
  });
  assert.equal(baseline.afterSelection, 0, "selection-only updates do not measure list layout");
  assert.ok(baseline.afterSourceEntry > 0, "Source entry measures the list layout for motion");
  assert.equal(baseline.afterStableRender, baseline.afterSourceEntry, "an unchanged Source row does not trigger layout measurement");
  assert.equal(baseline.afterSourceRemoved, 2);
  assert.equal(baseline.imagesRetained, true, "adding and removing Source preserves existing image rows");
  assert.equal(baseline.sourceEntryAnimated, true, "Source addition uses the existing entry animation");
  assert.equal(baseline.sourceGhostAnimated, true, "Source removal uses the existing exit animation");

  await page.emulateMedia({reducedMotion: "reduce"});
  const reducedMotion = await page.evaluate(() => {
    const fixture = window.__fixture;
    const before = fixture.animations.length;
    fixture.view.render(new Set(), fixture.source);
    const enteredCount = fixture.imagesElement.children.length;
    fixture.view.render(new Set(), null);
    return {before, after: fixture.animations.length, enteredCount};
  });
  assert.equal(reducedMotion.enteredCount, 3);
  assert.equal(reducedMotion.after, reducedMotion.before, "reduced motion suppresses Source entry and exit animations");
});
