import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionRoot = resolve(repository, "dist/extension");
const mimeTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const imagePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=", "base64");

async function serveExtension() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const target = resolve(extensionRoot, `.${pathname}`);
      if (target !== extensionRoot && !target.startsWith(`${extensionRoot}${sep}`)) throw new Error("Outside extension root");
      const body = await readFile(target);
      response.writeHead(200, { "content-type": mimeTypes[extname(target)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/app/index.html` };
}

function imageFixture(count, groupCount = 1) {
  const images = [];
  for (let group = 0; group < groupCount; group++) {
    for (let item = 0; item < Math.ceil(count / groupCount) && images.length < count; item++) {
      images.push(`https://images${group}.example.test/set-${group}/page-${String(item + 1).padStart(4, "0")}.jpg`);
    }
  }
  return { images, url: "https://source.example.test/gallery", title: "UI layout fixture" };
}

async function inspectLayout(page, width, height, label) {
  const result = await page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight, bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight },
      header: rect(".app-header"), main: rect("main"), controls: rect(".results-controls"),
      heading: rect(".results-heading"), groupBar: rect(".group-bar"), groups: rect("#groups"),
      viewerControls: rect(".viewer-controls"), status: rect("#status"), clear: rect("#reset"),
      scan: rect("#scan"), export: rect("#export"), viewer: rect("#viewer-toggle"),
      headingText: document.querySelector("#images-heading").getBoundingClientRect().toJSON(),
      groupCount: document.querySelectorAll("#groups .group-chip").length,
    };
  });
  assert.equal(result.viewport.width, width, `${label}: viewport width`);
  assert.equal(result.viewport.height, height, `${label}: viewport height`);
  assert.ok(result.header.height > 0, `${label}: header must be visible`);
  assert.ok(result.header.bottom <= result.main.y + 1, `${label}: header must not overlap main`);
  assert.ok(result.main.bottom <= height + 1, `${label}: main must remain inside viewport`);
  assert.equal(result.viewport.bodyHeight, height, `${label}: page must not gain vertical scrolling`);
  for (const [name, box] of Object.entries({
    heading: result.headingText,
    scan: result.scan,
    pdf: result.export,
    viewer: result.viewer,
    clear: result.clear,
  })) {
    assert.ok(box.width > 0 && box.height > 0, `${label}: ${name} must be visible`);
    assert.ok(box.x >= result.header.x && box.right <= result.header.right + 1, `${label}: ${name} must fit within header width`);
    assert.ok(box.y >= result.header.y && box.bottom <= result.header.bottom + 1, `${label}: ${name} must fit within header height`);
  }
  const rightColumnBottom = Math.max(result.status.bottom, result.clear.bottom, result.viewer.bottom);
  assert.ok(rightColumnBottom <= result.header.bottom + 1, `${label}: status, viewer, and clear controls must not be clipped`);
  assert.ok(result.groupBar.scrollWidth <= result.groupBar.clientWidth + 1, `${label}: group bar must not scroll horizontally`);
  const sourceGap = result.heading.y - result.scan.bottom;
  assert.ok(sourceGap >= 0 && sourceGap <= 9,
    `${label}: image heading must start immediately below the URL controls (gap ${sourceGap}px)`);
  return result;
}

async function scan(page, fixture) {
  await page.evaluate(value => { window.__harvestScanFixture = value; }, fixture);
  await page.locator("#scan").click();
  await page.waitForFunction(() => !document.querySelector("#scan").disabled);
  await page.waitForTimeout(280);
}

async function assertNoBrowserErrors(page, label, errors) {
  assert.deepEqual(errors, [], `${label}: browser reported JavaScript or console errors`);
}

test("real Chrome keeps the header stable and confines group scrolling across panel sizes and content states", async t => {
  const { server, url } = await serveExtension();
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
    const dimensions = [[1000, 800], [768, 600], [768, 300], [360, 800]];
    for (const locale of ["ja-JP", "en-US"]) {
      const context = await browser.newContext({ locale, reducedMotion: "reduce" });
      await context.addInitScript(() => {
        window.chrome = {
          runtime: { onConnect: { addListener() {} } },
          i18n: { getUILanguage: () => navigator.language },
          tabs: {
            query: async () => [{ id: 7, url: "https://source.example.test/gallery" }],
            get: async () => ({ id: 7, url: "https://source.example.test/gallery" }),
            onRemoved: { addListener() {}, removeListener() {} },
          },
          scripting: { executeScript: async () => {
            const fixture = window.__harvestScanFixture ?? { images: [], url: "https://source.example.test/gallery", title: "Fixture" };
            if (fixture.error) throw new Error(fixture.error);
            return [{ result: fixture }];
          } },
        };
      });
      await context.route("https://images*.example.test/**", route => route.fulfill({ status: 200, contentType: "image/png", body: imagePng }));
      for (const [width, height] of dimensions) {
        const caseName = `${locale} ${width}x${height}`;
        await t.test(caseName, async () => {
          const page = await context.newPage();
          const browserErrors = [];
          page.on("pageerror", error => browserErrors.push(`pageerror: ${error.message}`));
          page.on("console", message => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });
          try {
          await page.setViewportSize({ width, height });
          await page.goto(url);
          await page.locator("#images-heading").waitFor();
          assert.equal(await page.title(), locale === "ja-JP" ? "Harvest | 画像を集める" : "Harvest | Collect images", `${caseName}: document title should follow browser locale`);
          const empty = await inspectLayout(page, width, height, `${caseName} empty`);
          await scan(page, imageFixture(4, 1));
          const sourceOption = page.locator(".source-page-option span");
          const originalOption = await sourceOption.textContent();
          await sourceOption.evaluate(element => { element.textContent = "出典ページの追加 Source page"; });
          const wrappedOption = await inspectLayout(page, width, height, `${caseName} wrapped source option`);
          assert.equal(wrappedOption.heading.y, empty.heading.y, `${caseName}: right-side options must not push down the image heading`);
          await sourceOption.evaluate((element, text) => { element.textContent = text; }, originalOption);
          const few = await inspectLayout(page, width, height, `${caseName} few images`);
          assert.equal(few.header.height, empty.header.height, `${caseName}: image results must not change header height`);
          assert.equal(few.groupCount, 1, `${caseName}: fixture should create one group`);
          await scan(page, imageFixture(120, 36));
          const many = await inspectLayout(page, width, height, `${caseName} many groups`);
          assert.equal(many.header.height, empty.header.height, `${caseName}: group count must not change header height`);
          assert.ok(many.groupCount >= 30, `${caseName}: many-group fixture should create at least 30 groups`);
          assert.ok(many.groupBar.scrollHeight > many.groupBar.clientHeight, `${caseName}: group list must overflow its own viewport`);
          assert.equal(many.controls.scrollHeight, many.controls.clientHeight, `${caseName}: results controls must not scroll as a whole`);
          const scrollState = await page.locator(".group-bar").evaluate(element => {
            const start = element.scrollTop;
            const controls = element.closest(".results-controls");
            const main = document.querySelector("main");
            element.scrollTop = element.scrollHeight;
            return {
              overflowY: getComputedStyle(element).overflowY,
              headerOverflow: getComputedStyle(document.querySelector(".app-header")).overflow,
              controlsOverflowY: getComputedStyle(controls).overflowY,
              start,
              end: element.scrollTop,
              controlsScrollTop: controls.scrollTop,
              mainScrollTop: main.scrollTop,
            };
          });
          assert.equal(scrollState.overflowY, "auto", `${caseName}: the group bar should own vertical scrolling`);
          assert.equal(scrollState.headerOverflow, "hidden", `${caseName}: the header itself must not scroll`);
          assert.equal(scrollState.controlsOverflowY, "visible", `${caseName}: surrounding controls must not scroll`);
          assert.equal(scrollState.start, 0, `${caseName}: group list should begin at the top`);
          assert.ok(scrollState.end > 0, `${caseName}: group list should move when scrolled`);
          assert.equal(scrollState.controlsScrollTop, 0, `${caseName}: controls container must remain still`);
          assert.equal(scrollState.mainScrollTop, 0, `${caseName}: main content must remain still`);
          const lastGroup = page.locator("#groups .group-chip").last().locator("button");
          await lastGroup.scrollIntoViewIfNeeded();
          await lastGroup.click();
          assert.equal(await lastGroup.getAttribute("aria-pressed"), "true", `${caseName}: final group must remain operable after scrolling`);
          await page.locator("#reset").click();
          await page.evaluate(message => { window.__harvestScanFixture = { error: message }; }, "A deliberately long scan error used to exercise status rendering. ".repeat(12));
          await page.locator("#scan").click();
          await page.waitForFunction(() => !document.querySelector("#scan").disabled && Boolean(document.querySelector("#status").textContent));
          await page.waitForTimeout(280);
          const longStatus = await inspectLayout(page, width, height, `${caseName} long status`);
          assert.equal(longStatus.header.height, empty.header.height, `${caseName}: status text must not change header height`);
          assert.ok(longStatus.status.height > 0, `${caseName}: status must remain visible`);
          assert.equal(await page.locator("#status").getAttribute("title"), await page.locator("#status").textContent(), `${caseName}: status title should preserve the full displayed message`);
          // Unknown scan errors are localized to a short fallback. Also stress the actual
          // status element with long content so wrapping regressions cannot pass unnoticed.
          await page.locator("#status").evaluate(element => {
            element.textContent = "Harvest status / 状態を表示するための長い文章です。".repeat(8);
          });
          const wrappedStatus = await inspectLayout(page, width, height, `${caseName} long status content`);
          assert.equal(wrappedStatus.header.height, empty.header.height, `${caseName}: long content must not change header height`);
          assert.ok(wrappedStatus.status.height > 0, `${caseName}: long content must remain visible`);
          await assertNoBrowserErrors(page, caseName, browserErrors);
          } catch (error) {
            const screenshot = join(tmpdir(), `harvest-ui-layout-${locale}-${width}x${height}.png`);
            await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
            error.message += `\nFailure screenshot: ${screenshot}`;
            throw error;
          } finally {
            await page.close();
          }
        });
      }
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
