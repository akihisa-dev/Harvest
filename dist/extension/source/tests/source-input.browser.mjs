import assert from "node:assert/strict";
import test from "node:test";
import {startServer, launchBrowser} from "./support/browser.mjs";
import {extensionFile} from "./support/extension-files.mjs";

test("Chromeの日本語変換中はURL解析せず、確定後のEnterとボタンで解析する", async t => {
  const server = await startServer(t, async (request, response) => {
    if (request.url === "/") {
      response.writeHead(200, {"content-type": "text/html; charset=utf-8"});
      response.end(`<input id="url"><button id="display"></button><div id="overlay"></div><button id="scan">Scan</button>
        <script type="module">
          import {createSourceInputController} from "/app/panel/source-input-controller.js";
          window.scans = [];
          const input = document.querySelector("#url");
          const scan = () => window.scans.push(input.value);
          createSourceInputController({input, display: document.querySelector("#display"),
            dropOverlay: document.querySelector("#overlay"), placeholder: "URL", getResultFilename: () => "",
            isBusy: () => false, isReordering: () => false, onScan: scan});
          document.querySelector("#scan").onclick = scan;
          window.ready = true;
        </script>`);
    } else {
      try {
        const file = await extensionFile(request.url);
        response.writeHead(200, {"content-type": file.contentType});
        response.end(file.body);
      } catch { response.writeHead(404).end(); }
    }
  });
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ready);
  const input = page.locator("#url");
  await input.fill("https://example.test/");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {text: "日本語", selectionStart: 3, selectionEnd: 3});
  await input.dispatchEvent("keydown", {key: "Enter", isComposing: true, keyCode: 229});
  assert.deepEqual(await page.evaluate(() => window.scans), []);
  await cdp.send("Input.insertText", {text: "日本語"});
  await input.dispatchEvent("keydown", {key: "Enter", isComposing: false, keyCode: 229});
  assert.deepEqual(await page.evaluate(() => window.scans), []);
  assert.equal(await input.isVisible(), true);
  await input.press("Enter");
  await page.locator("#scan").click();
  await page.locator("#display").click();
  await input.fill("https://example.test/ascii");
  await input.press("Enter");
  assert.deepEqual(await page.evaluate(() => window.scans), [
    "https://example.test/日本語", "https://example.test/日本語", "https://example.test/ascii",
  ]);
});
