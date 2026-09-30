import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {chromium} from "playwright";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extension = resolve(root, "dist/extension");

async function serve() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/test.html") {
        response.writeHead(200, {"content-type": "text/html"});
        response.end(`<!doctype html><html><body>
          <section id="results"></section><section id="viewer"><p id="empty"></p><div id="page"><div id="stage"><img id="image"></div>
            <button id="previous"></button><button id="next"></button><span id="position"></span><p id="filename"></p><ol id="thumbnails"></ol>
            <button id="zoom-in"></button><button id="zoom-out"></button><button id="zoom-reset"></button></div></section><button id="toggle"></button>
          <script type="module">
            import {createViewerController} from "/app/viewer-controller.js";
            const pages = [1, 2, 3].map(index => ({url: "https://images.example.test/" + index + ".jpg", sourcePage: "https://source.example.test"}));
            const get = selector => document.querySelector(selector);
            const bindings = new WeakMap();
            const previewLoader = {
              set(image, item) { bindings.set(image, item.url); image.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="; },
              clearImage(image) { bindings.delete(image); image.removeAttribute("src"); },
            };
            const elements = {
              toggle: get("#toggle"), viewer: get("#viewer"), empty: get("#empty"), page: get("#page"),
              previous: get("#previous"), next: get("#next"), position: get("#position"), stage: get("#stage"),
              image: get("#image"), filename: get("#filename"), thumbnails: get("#thumbnails"),
              zoomIn: get("#zoom-in"), zoomOut: get("#zoom-out"), zoomReset: get("#zoom-reset"), results: get("#results"),
            };
            let busy = false;
            let controller;
            controller = createViewerController({
              elements, getPages: () => pages, getPageLabel: item => item.url, isBusy: () => busy,
              getImageCount: () => pages.length, previewLoader, onChange: () => controller.render(),
            });
            window.__viewer = controller;
            window.__setBusy = value => { busy = value; };
            controller.setOpen(true);
            controller.render();
          </script>
        </body></html>`);
        return;
      }
      if (pathname === "/app/viewer-controller.js") {
        const source = await readFile(resolve(root, "src/extension/viewer-controller.ts"), "utf8");
        const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}});
        response.writeHead(200, {"content-type": "text/javascript"});
        response.end(outputText);
        return;
      }
      const target = resolve(extension, `.${pathname}`);
      if (target !== extension && !target.startsWith(`${extension}${sep}`)) throw new Error("outside extension");
      const body = await readFile(target);
      const mime = {[".css"]: "text/css", [".js"]: "text/javascript"};
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
  return {server, url: `http://127.0.0.1:${server.address().port}/test.html`};
}

test("viewer thumbnail wheel only cancels when it changes the image", async () => {
  const {server, url} = await serve();
  let browser;
  try {
    browser = await chromium.launch({channel: "chrome", headless: true});
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.__viewer));
    const wheel = (deltaX, deltaY) => page.locator("#thumbnails").evaluate((list, [x, y]) => {
      const event = new WheelEvent("wheel", {deltaX: x, deltaY: y, bubbles: true, cancelable: true});
      list.dispatchEvent(event);
      return event.defaultPrevented;
    }, [deltaX, deltaY]);
    const position = () => page.locator("#position").textContent();
    const waitForCooldown = () => page.waitForTimeout(200);

    assert.equal(await position(), "1 / 3");
    assert.equal(await wheel(0, -120), false, "the first page allows upward page scrolling");
    assert.equal(await position(), "1 / 3");
    assert.equal(await wheel(0, 120), true, "moving to the next page cancels the wheel scroll");
    assert.equal(await position(), "2 / 3");
    await waitForCooldown();
    assert.equal(await wheel(0, 120), true);
    assert.equal(await position(), "3 / 3");
    await waitForCooldown();
    assert.equal(await wheel(0, 120), false, "the last page allows downward page scrolling");
    assert.equal(await position(), "3 / 3");
    assert.equal(await wheel(0, -120), true, "the last page still moves backward");
    assert.equal(await position(), "2 / 3");
    await waitForCooldown();
    assert.equal(await wheel(120, 0), true, "horizontal wheel keeps the existing next-page behavior");
    assert.equal(await position(), "3 / 3");
    await waitForCooldown();
    await page.evaluate(() => window.__setBusy(true));
    assert.equal(await wheel(0, -120), false, "busy state leaves the wheel event available to page scrolling");
    assert.equal(await position(), "3 / 3");
  } finally {
    await browser?.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
