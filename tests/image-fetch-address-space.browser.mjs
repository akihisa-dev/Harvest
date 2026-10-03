import {startServer, temporaryDirectory, launchExtensionContext} from "./support/browser.mjs";
import assert from "node:assert/strict";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import test from "node:test";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionRoot = resolve(repository, "dist/extension");
const localImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=", "base64");

test("Chrome blocks a public image hostname that resolves to loopback", {timeout: 60_000}, async (t) => {
  const received = [];
  const server = await startServer(t, (request, response) => {
    received.push(request.url);
    response.writeHead(200, {"access-control-allow-origin": "*", "content-type": "image/png"});
    response.end(localImage);
  });

  const temporaryRoot = await temporaryDirectory(t, join(tmpdir(), "harvest-image-address-space-"));
    let cdp;
  try {
    const context = await launchExtensionContext(t, join(temporaryRoot, "profile"), {args: [
        "--enable-unsafe-extension-debugging",
        "--host-resolver-rules=MAP dns-public-test.invalid 127.0.0.1, MAP * ~NOTFOUND",
        "--disable-background-networking",
        "--disable-component-update",
        "--no-first-run",
        "--no-default-browser-check",
      ]});
    const browser = context.browser();
    assert.ok(browser, "the persistent Chrome context must expose its browser session");
    cdp = await browser.newBrowserCDPSession();
    const {id: extensionId} = await cdp.send("Extensions.loadUnpacked", {path: extensionRoot});
    assert.match(extensionId, /^[a-p]{32}$/);
    const {extensions} = await cdp.send("Extensions.getExtensions");
    assert.ok(extensions.some(extension => extension.id === extensionId), "Harvest must be loaded as an unpacked extension");

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/app/index.html`);
    const result = await page.evaluate(async port => {
      const {fetchImage} = await import(chrome.runtime.getURL("app/media/image-fetch.js"));
      const url = `http://dns-public-test.invalid:${port}/image.png`;
      const direct = await fetch(`${url}?case=without-address-space`);
      await direct.arrayBuffer();
      let harvest;
      try {
        await fetchImage(`${url}?case=harvest`, {sourcePage: "https://source.example.test/gallery"});
        harvest = {resolved: true};
      } catch (error) {
        harvest = {resolved: false, kind: error.kind};
      }
      return {directStatus: direct.status, harvest};
    }, server.address().port);

    assert.deepEqual(result, {directStatus: 200, harvest: {resolved: false, kind: "network"}});
    assert.deepEqual(received, ["/image.png?case=without-address-space"]);
  } finally {
    await cdp?.detach();

  }
});
