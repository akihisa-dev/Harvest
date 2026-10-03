import {temporaryDirectory, launchExtensionContext} from "./support/browser.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

test("実Chromeの停止ボタンは普通ページ・個別投稿の旧結果を保持し、遅い応答より先に再解析できる", async (t) => {
  const temp = await temporaryDirectory(t, join(tmpdir(), "harvest-scan-stop-"));
  const context = await launchExtensionContext(t, join(temp, "profile"));
  const cdp = await context.browser().newBrowserCDPSession();
  const {id} = await cdp.send("Extensions.loadUnpacked", {path: resolve("dist/extension")});
  // All Web documents and resources are local fixtures; no real X requests.
  await context.route("**/*", route => route.request().url().startsWith("chrome-extension:") ? route.continue()
    : route.request().resourceType() === "document" ? route.fulfill({contentType: "text/html", body: "<!doctype html><main></main>"}) : route.abort());
  const target = await context.newPage(), panel = await context.newPage();
  for (const phase of ["normal-initial", "post-initial", "post-wait"]) for (const clicks of [1, 3]) {
    await target.goto("https://fixture.test/old");
    await target.evaluate(() => { document.querySelector("main").innerHTML = '<img data-src="https://fixture.test/old1.png"><img data-src="https://fixture.test/old2.png">'; });
    await panel.goto(`chrome-extension://${id}/app/index.html`);
    await panel.evaluate(async () => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      const [target] = await query({url: "https://fixture.test/old"});
      chrome.tabs.query = async options => options.active ? [await chrome.tabs.get(target.id)] : query(options);
      const {ImageCollection} = await import(chrome.runtime.getURL("core/image-collection.js"));
      const replace = ImageCollection.prototype.replace;
      window.publications = 0;
      ImageCollection.prototype.replace = function (...args) {
        window.collection = this; window.publications++;
        return replace.apply(this, args);
      };
    });
    await panel.locator("#scan").click();
    await panel.waitForFunction(() => document.querySelector("#scan").dataset.scanning === "false");
    await panel.evaluate(() => {
      window.collection.setSelected("https://fixture.test/old1.png", false);
      window.collection.applyVisibleOrder(window.collection.items, [...window.collection.items].reverse());
      window.previous = window.collection.items;
    });
    await target.goto(phase.startsWith("normal") ? "https://fixture.test/new" : "https://x.com/user/status/123");
    await target.evaluate(phase => {
      window.mount = () => {
        if (phase.startsWith("normal")) { document.querySelector("main").innerHTML = '<img data-src="https://fixture.test/new.png">'; return; }
        const article = document.createElement("article"); article.dataset.testid = "tweet";
        article.innerHTML = '<a href="/user/status/123"><time>Today</time></a><img data-src="https://pbs.twimg.com/media/new.jpg">';
        article.__reactFiber$fixture = {memoizedProps: {tweet: {id_str: "123", extended_entities: {media: [{type: "photo", media_url_https: "https://pbs.twimg.com/media/new.jpg"}]}}}};
        document.querySelector("main").append(article);
      };
      if (phase !== "post-wait") window.mount();
    }, phase);
    await panel.evaluate(phase => {
      const execute = chrome.scripting.executeScript.bind(chrome.scripting);
      window.gated = false; window.trace = [];
      chrome.scripting.executeScript = async request => {
        window.trace.push(request.func.name);
        const work = execute(request); // Real injection, including a real empty-DOM wait.
        if (!window.gated && request.func.name === (phase === "post-wait" ? "waitForXPage" : "scanDocument")) {
          window.gated = true; await new Promise(resolve => { window.release = resolve; });
        }
        return work;
      };
    }, phase);
    await panel.locator("#scan").click();
    await panel.waitForFunction(() => window.gated);
    // Multiple stop events while the session still owns the pending operation.
    await panel.evaluate(clicks => { for (let i = 0; i < clicks; i++) document.querySelector("#scan").click(); }, clicks);
    await panel.waitForFunction(() => document.querySelector("#scan").dataset.scanning === "false");
    const stopped = await panel.evaluate(() => ({same: window.collection.items === window.previous,
      items: window.collection.items.map(item => [item.url, item.selected]), publications: window.publications,
      overlay: !document.querySelector("#scan-overlay").hidden, disabled: document.querySelector("#scan").disabled,
      status: document.querySelector("#status").dataset.state, trace: window.trace}));
    assert.equal(stopped.same, true, phase);
    assert.deepEqual(stopped.items, [["https://fixture.test/old2.png", true], ["https://fixture.test/old1.png", false]]);
    assert.equal(stopped.publications, 1); assert.equal(stopped.overlay, false); assert.equal(stopped.disabled, false);
    assert.equal(stopped.status, "info");
    assert.deepEqual(stopped.trace, phase === "post-wait" ? ["scanDocument", "waitForXPage"] : ["scanDocument"]);
    if (phase === "post-wait") await target.evaluate(() => window.mount());
    await panel.locator("#scan").click();
    await panel.waitForFunction(() => document.querySelector("#scan").dataset.scanning === "false");
    await panel.evaluate(() => window.release()); // The old session returns after the new publication.
    await panel.waitForTimeout(500);
    const done = await panel.evaluate(() => ({publications: window.publications, urls: window.collection.items.map(item => item.url),
      rows: [...document.querySelectorAll("[data-focus-url]")].map(row => row.dataset.focusUrl)}));
    assert.equal(done.publications, 2);
    assert.deepEqual(done.urls, [phase.startsWith("normal") ? "https://fixture.test/new.png" : "https://pbs.twimg.com/media/new?format=jpg&name=orig"]);
    assert.deepEqual(done.rows, done.urls);
  }
});
