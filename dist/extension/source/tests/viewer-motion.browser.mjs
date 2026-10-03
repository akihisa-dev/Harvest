import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {chromium} from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extension = resolve(root, "dist/extension");
const mime = {".css": "text/css", ".js": "text/javascript"};

async function serve() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/test.html") {
        response.writeHead(200, {"content-type": "text/html"});
        response.end(`<!doctype html><html><head><link rel="stylesheet" href="/app/style.css"><link rel="stylesheet" href="/app/viewer-motion.css"></head><body>
          <main><section id="results" class="results"></section>
            <section id="viewer" class="viewer" hidden><p id="empty"></p><div id="page"><div id="stage" class="viewer-stage"><img id="image"></div><button id="previous"></button><button id="next"></button><span id="position"></span><p id="filename"></p><ol id="thumbnails"></ol><button id="zoom-in"></button><button id="zoom-out"></button><button id="zoom-reset"></button></div></section>
          </main><button id="toggle"></button>
          <script type="module">
            import {createViewerController} from "/app/viewer-controller.js";
            const png = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
            const pages = [1, 2].map(index => ({url: "https://images.example.test/" + index + ".jpg", sourcePage: "https://source.example.test"}));
            const get = selector => document.querySelector(selector);
            const bindings = new Map();
            let pendingLoads = 0;
            const previewLoader = {
              set(image, item) {
                bindings.set(image, item.url);
                delete image.dataset.previewFailed;
                const value = item.url.endsWith("/1.jpg") ? png : "delay";
                if (value === png) image.src = png;
                else {
                  pendingLoads++;
                  setTimeout(() => {
                    pendingLoads--;
                    if (bindings.get(image) === item.url) image.src = png;
                  }, 350);
                }
                image.dataset.previewUrl = item.url;
              },
              clearImage(image) { bindings.delete(image); image.removeAttribute("src"); },
            };
            const elements = {
              toggle: get("#toggle"), viewer: get("#viewer"), empty: get("#empty"), page: get("#page"),
              previous: get("#previous"), next: get("#next"), position: get("#position"), stage: get("#stage"),
              image: get("#image"), filename: get("#filename"), thumbnails: get("#thumbnails"),
              zoomIn: get("#zoom-in"), zoomOut: get("#zoom-out"), zoomReset: get("#zoom-reset"), results: get("#results"),
            };
            let controller;
            controller = createViewerController({
              elements, getPages: () => pages, getPageLabel: item => item.url, isBusy: () => false,
              getImageCount: () => pages.length, previewLoader, onChange: () => controller.render(),
            });
            window.__viewerReady = controller;
            window.__viewerFixture = {pages, bindings, get pendingLoads() { return pendingLoads; }};
            controller.setOpen(true);
            controller.render();
          </script>
        </body></html>`);
        return;
      }
      const target = resolve(extension, `.${pathname}`);
      if (target !== extension && !target.startsWith(`${extension}${sep}`)) throw new Error("outside extension");
      const body = await readFile(target);
      response.writeHead(200, {"content-type": mime[extname(target)] ?? "application/octet-stream"});
      response.end(body);
    } catch {
      if (!response.headersSent) response.writeHead(404).end();
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {server, url: `${baseUrl}/test.html`};
}

test("viewer drag follows zoom changes and ends at 100%, page changes, and pointercancel", async () => {
  const {server, url} = await serve();
  let browser;
  try {
    browser = await chromium.launch({channel: "chrome", headless: true});
    const page = await browser.newPage({reducedMotion: "reduce"});
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.__viewerReady));
    await page.locator("#stage").evaluate(stage => {
      stage.style.width = "500px";
      stage.style.height = "300px";
      window.__wheels = 0;
      stage.addEventListener("wheel", () => window.__wheels++);
      stage.addEventListener("pointerdown", event => window.__pointerId = event.pointerId);
    });
    const box = await page.locator("#stage").boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const state = () => page.locator("#stage").evaluate(stage => {
      const matrix = new DOMMatrix(document.querySelector("#image").style.transform);
      return {x: matrix.e, y: matrix.f, zoom: matrix.a,
        captured: stage.hasPointerCapture(window.__pointerId), panning: stage.dataset.panning ?? null};
    });
    const wheel = async delta => {
      const count = await page.evaluate(() => window.__wheels);
      await page.mouse.wheel(0, delta);
      await page.waitForFunction(previous => window.__wheels > previous, count);
    };
    await page.locator("#zoom-in").click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 20);
    assert.deepEqual(await state(), {x: 30, y: 20, zoom: 1.25, captured: true, panning: "true"});
    await wheel(2000);
    assert.deepEqual(await state(), {x: 0, y: 0, zoom: 1, captured: false, panning: null}, "100% ends the captured drag immediately");
    await page.mouse.move(x + 80, y + 40);
    assert.deepEqual(await state(), {x: 0, y: 0, zoom: 1, captured: false, panning: null});
    await wheel(-300);
    const enlarged = await state();
    assert.ok(enlarged.zoom > 1);
    await page.mouse.move(x + 90, y + 50);
    assert.deepEqual(await state(), enlarged, "zooming back in while held does not revive the old drag");
    await page.mouse.up();

    await page.locator("#zoom-reset").click();
    await page.locator("#zoom-in").click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 20);
    for (const delta of [-300, 100]) {
      await wheel(delta);
      const afterZoom = await state();
      assert.ok(afterZoom.zoom > 1);
      assert.equal(afterZoom.captured, true);
      await page.mouse.move(x + 40, y + 25);
      const afterMove = await state();
      assert.ok(Math.abs(afterMove.x - afterZoom.x - 10) < 1e-8);
      assert.ok(Math.abs(afterMove.y - afterZoom.y - 5) < 1e-8);
      assert.equal(afterMove.zoom, afterZoom.zoom);
      await page.mouse.move(x + 30, y + 20);
    }
    await page.mouse.up();
    const released = await state();
    assert.equal(released.captured, false);
    assert.equal(released.panning, null);
    await page.mouse.move(x + 50, y + 30);
    assert.deepEqual(await state(), released, "pointerup preserves the final position and ends dragging");

    await page.mouse.down();
    await page.mouse.move(x + 60, y + 35);
    await page.locator("#stage").evaluate(stage => stage.dispatchEvent(new PointerEvent("pointercancel", {pointerId: window.__pointerId})));
    const canceled = await state();
    assert.equal(canceled.captured, false);
    assert.equal(canceled.panning, null);
    await page.mouse.move(x + 70, y + 40);
    assert.deepEqual(await state(), canceled);
    await page.mouse.up();

    await page.mouse.down();
    await page.mouse.move(x + 80, y + 45);
    await page.locator("#next").evaluate(button => button.click());
    assert.equal(await page.locator("#position").textContent(), "2 / 2");
    assert.deepEqual(await state(), {x: 0, y: 0, zoom: 1, captured: false, panning: null});
    await page.mouse.move(x + 90, y + 50);
    assert.deepEqual(await state(), {x: 0, y: 0, zoom: 1, captured: false, panning: null});
    await page.mouse.up();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});

test("viewer waits for the next preview before its directional transition and honors reduced motion", async () => {
  const {server, url} = await serve();
  let browser;
  try {
    browser = await chromium.launch({channel: "chrome", headless: true});
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.__viewerReady));
    const modeTransition = await page.locator("#viewer").evaluate(element => getComputedStyle(element).transitionProperty);
    assert.match(modeTransition, /opacity/);
    assert.match(modeTransition, /display/);
    await page.waitForFunction(() => document.querySelector("#image").complete && document.querySelector("#image").naturalWidth > 0);
    await page.locator("#next").click();
    assert.equal(await page.locator(".viewer-motion-image[data-motion='holding']").count(), 1, "the previous image stays visible while the next preview loads");
    await page.waitForFunction(() => document.querySelector("#image").dataset.motion === "incoming");
    assert.equal(await page.locator("#image").getAttribute("data-direction"), "next");
    assert.equal(await page.locator(".viewer-motion-image[data-motion='outgoing']").count(), 1);
    await page.waitForFunction(() => !document.querySelector(".viewer-motion-image"));

    const retargeted = await page.evaluate(() => {
      const viewer = document.querySelector("#viewer");
      window.__viewerReady.setOpen(false);
      window.__viewerReady.render();
      getComputedStyle(viewer).opacity;
      const outgoing = viewer.getAnimations();
      outgoing.forEach(a => {
        a.pause();
        a.currentTime = 80;
      });
      const mid = Number(getComputedStyle(viewer).opacity);
      window.__viewerReady.setOpen(true);
      window.__viewerReady.render();
      getComputedStyle(viewer).opacity;
      return {mid, active: viewer.getAnimations().length};
    });
    assert.ok(retargeted.mid > 0 && retargeted.mid < 1, JSON.stringify(retargeted));
    assert.ok(retargeted.active > 0, "rapid mode changes retarget the current CSS transition");
    await page.emulateMedia({reducedMotion: "reduce"});
    await page.locator("#previous").click();
    assert.equal(await page.locator(".viewer-motion-image").count(), 0, "reduced motion skips the image transition");
  } finally {
    await browser?.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});

test("viewer retargeting, failed previews and clearing release obsolete image bindings", async () => {
  const {server, url} = await serve();
  let browser;
  try {
    browser = await chromium.launch({channel: "chrome", headless: true});
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__viewerReady && document.querySelector("#image").naturalWidth > 0);
    await page.evaluate(() => {
      document.querySelector("#next").click();
      document.querySelector("#previous").click();
    });
    await page.waitForFunction(() => document.querySelector("#image").dataset.direction === "previous");
    const retargeted = await page.evaluate(async () => {
      const image = document.querySelector("#image");
      for (const element of [image, ...document.querySelectorAll(".viewer-motion-image")]) {
        for (const animation of element.getAnimations()) {
          animation.pause();
          animation.currentTime = 80;
        }
      }
      document.querySelector("#next").click();
      await Promise.resolve();
      await Promise.resolve();
      const ghosts = [...document.querySelectorAll(".viewer-motion-image")];
      return {
        ghosts: ghosts.length,
        holding: ghosts.every(ghost => ghost.dataset.motion === "holding"),
        detached: [...window.__viewerFixture.bindings.keys()].filter(element => !element.isConnected).length
      };
    });
    assert.ok(retargeted.ghosts > 0 && retargeted.ghosts <= 4, JSON.stringify(retargeted));
    assert.equal(retargeted.holding, true, "interrupted animation completion does not remove the new holding images");
    assert.equal(retargeted.detached, 0, "superseded visual layers release their preview bindings");

    await page.evaluate(() => { document.querySelector("#image").dataset.previewFailed = "true"; });
    await page.waitForFunction(() => !document.querySelector(".viewer-motion-image"));
    assert.equal(await page.evaluate(() => window.__viewerFixture.bindings.size), 3,
      "failure releases outgoing images while keeping the active image and two thumbnails");

    const cleared = await page.evaluate(() => {
      document.querySelector("#previous").click();
      document.querySelector("#next").click();
      const pendingGhosts = document.querySelectorAll(".viewer-motion-image").length;
      window.__viewerReady.clearCurrentPage();
      const clearedPage = {
        ghosts: document.querySelectorAll(".viewer-motion-image").length,
        bindings: window.__viewerFixture.bindings.size,
        src: document.querySelector("#image").getAttribute("src")
      };
      window.__viewerFixture.pages.length = 0;
      window.__viewerReady.render();
      return {pendingGhosts, clearedPage, bindings: window.__viewerFixture.bindings.size};
    });
    assert.ok(cleared.pendingGhosts > 0, "the collection is cleared while an image transition is pending");
    assert.deepEqual(cleared.clearedPage, {ghosts: 0, bindings: 2, src: null},
      "clearing the current page releases its active and outgoing bindings before another render");
    assert.equal(cleared.bindings, 0);
    await page.waitForFunction(() => window.__viewerFixture.pendingLoads === 0);
    assert.equal(await page.locator(".viewer-motion-image").count(), 0);
    assert.equal(await page.locator("#image").getAttribute("src"), null, "late preview loads cannot restore cleared content");
    assert.equal(await page.locator("#image").getAttribute("data-motion"), null);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
