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
      header: rect(".app-header"), main: rect("main"), sidebar: rect(".workspace-sidebar"), controls: rect(".results-controls"),
      heading: rect(".results-heading"), groupBar: rect(".group-bar"), groups: rect("#groups"),
      viewerControls: rect(".viewer-controls"), status: rect("#status"), clear: rect("#reset"),
      source: rect("#source-drop"), scan: rect("#scan"), collect: rect("#collection-toggle"), export: rect("#export"), viewer: rect("#viewer-toggle"),
      viewerPageVisible: !document.querySelector("#viewer-page").hidden && !document.querySelector("#viewer").hidden,
      stage: rect("#viewer-stage"),
      allVisibility: rect("#all-visibility"), allSelection: rect(".toolbar-check"), resetOrder: rect("#reset-order"),
      headingText: document.querySelector("#images-heading").getBoundingClientRect().toJSON(),
      groupCount: document.querySelectorAll("#groups .group-chip").length,
      firstGroup: document.querySelector("#groups .group-chip")?.getBoundingClientRect().toJSON(),
      firstGroupEye: document.querySelector("#groups .group-chip button")?.getBoundingClientRect().toJSON(),
      firstGroupSelection: document.querySelector("#groups .group-check")?.getBoundingClientRect().toJSON(),
    };
  });
  assert.equal(result.viewport.width, width, `${label}: viewport width`);
  assert.equal(result.viewport.height, height, `${label}: viewport height`);
  assert.ok(result.header.height > 0, `${label}: header must be visible`);
  assert.ok(result.header.bottom <= result.main.y + 1, `${label}: header must not overlap main`);
  assert.ok(result.main.bottom <= height + 1, `${label}: main must remain inside viewport`);
  assert.equal(result.viewport.bodyHeight, height, `${label}: page must not gain vertical scrolling`);
  for (const [name, box] of Object.entries({source: result.source, scan: result.scan, clear: result.clear, collect: result.collect})) {
    assert.ok(box.width > 0 && box.height > 0, `${label}: ${name} must be visible`);
    assert.ok(box.x >= result.header.x && box.right <= result.header.right + 1, `${label}: ${name} must fit within header width`);
    assert.ok(box.y >= result.header.y && box.bottom <= result.header.bottom + 1, `${label}: ${name} must fit within header height`);
  }
  assert.ok(result.source.right <= result.scan.x && result.scan.right <= result.clear.x && result.clear.right <= result.collect.x,
    `${label}: URL, analyze, clear, and collect must stay in this order`);
  assert.ok(Math.abs(result.scan.x - result.export.x) <= 1, `${label}: header actions and save button must share the left edge (${result.scan.x}, ${result.export.x})`);
  assert.ok(Math.abs(result.collect.right - result.export.right) <= 1, `${label}: header actions and save button must share the right edge (${result.collect.right}, ${result.export.right})`);
  if (result.viewerPageVisible) {
    assert.ok(Math.abs(result.source.x - result.main.x) <= 1, `${label}: URL field and gray viewer area must share the left edge (${result.source.x}, ${result.main.x})`);
    assert.ok(Math.abs(result.source.right - result.stage.right) <= 1, `${label}: URL field and image stage must share the right edge (${result.source.right}, ${result.stage.right})`);
  } else {
    assert.ok(Math.abs(result.source.x - result.main.x) <= 1, `${label}: URL field and empty area must share the left edge (${result.source.x}, ${result.main.x})`);
    assert.ok(Math.abs(result.source.right - result.main.right) <= 1, `${label}: URL field and empty area must share the right edge (${result.source.right}, ${result.main.right})`);
  }
  assert.ok(result.sidebar.x >= result.main.right - 1, `${label}: controls must be to the right of the image`);
  assert.ok(result.sidebar.right <= width + 1, `${label}: sidebar must fit within viewport`);
  assert.ok(result.sidebar.scrollWidth <= result.sidebar.clientWidth + 1, `${label}: sidebar must not scroll horizontally`);
  for (const [name, box] of Object.entries({heading: result.headingText, pdf: result.export, viewer: result.viewer})) {
    assert.ok(box.width > 0 && box.height > 0, `${label}: ${name} must be laid out`);
    assert.ok(box.x >= result.sidebar.x && box.right <= result.sidebar.right + 1, `${label}: ${name} must fit in sidebar width`);
  }
  assert.ok(result.export.y < result.viewer.y && result.viewer.y < result.headingText.y,
    `${label}: PDF, list toggle, and image groups must be arranged vertically`);
  assert.ok(result.headingText.bottom <= result.resetOrder.y, `${label}: heading must stay above selection actions`);
  assert.ok(result.resetOrder.right <= result.allVisibility.x && result.allVisibility.right <= result.allSelection.x,
    `${label}: reset, all-images eye, and all-images checkbox must fit in one row`);
  for (const [name, box] of Object.entries({resetOrder: result.resetOrder, allVisibility: result.allVisibility, allSelection: result.allSelection})) {
    assert.ok(Math.abs(box.width - box.height) <= 1, `${label}: ${name} must be a square icon button`);
  }
  assert.ok(result.allSelection.right <= result.sidebar.right + 1, `${label}: selection actions must fit sidebar width`);
  if (result.firstGroup && result.firstGroupEye && result.firstGroupSelection) {
    assert.ok(Math.abs(result.firstGroup.x - result.resetOrder.x) <= 1, `${label}: reset and group rows must share the left edge`);
    assert.ok(Math.abs(result.firstGroup.right - result.allSelection.right) <= 1, `${label}: selection and group rows must share the right edge`);
    assert.ok(Math.abs(result.firstGroupEye.x - result.allVisibility.x) <= 1, `${label}: group eyes must line up with the all-images eye`);
    assert.ok(Math.abs(result.firstGroupSelection.x - result.allSelection.x) <= 1, `${label}: group checkboxes must line up with the all-images checkbox`);
  }
  assert.ok(result.groupBar.scrollWidth <= result.groupBar.clientWidth + 1, `${label}: group bar must not scroll horizontally`);
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

test("real Chrome keeps the large viewer beside vertical controls across panel sizes and content states", async t => {
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
            if (fixture.pending) await new Promise(resolve => { window.__releaseScanFixture = resolve; });
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
          assert.equal(await page.locator("#images-heading").textContent(), locale === "ja-JP" ? "画像グループ" : "Image groups");
          const resetName = locale === "ja-JP" ? "全部元に戻す" : "Restore order and selection";
          assert.equal(await page.getByRole("button", {name: resetName, exact: true}).count(), 1, `${caseName}: reset action needs an accessible name`);
          assert.equal(await page.locator("#all-visibility").getAttribute("aria-label"), locale === "ja-JP" ? "すべての画像を表示" : "Show all images");
          assert.equal(await page.locator("#all-selection").getAttribute("aria-label"), locale === "ja-JP" ? "すべて選択" : "Select all");
          for (const selector of ["#all-visibility", "#reset-order"]) {
            assert.equal(await page.locator(`${selector} svg`).count(), 1, `${caseName}: action icon must be visible`);
          }
          assert.equal(await page.locator(".workspace-sidebar").getAttribute("aria-label"),
            locale === "ja-JP" ? "画像と保存の操作" : "Image and save controls", `${caseName}: sidebar label should follow browser locale`);
          const empty = await inspectLayout(page, width, height, `${caseName} empty`);
          const pendingFixture = {...imageFixture(4, 1), pending: true};
          await page.evaluate(value => { window.__harvestScanFixture = value; }, pendingFixture);
          await page.locator("#scan").click();
          await page.waitForFunction(() => document.querySelector("#status").dataset.state === "busy");
          const spinnerState = await page.evaluate(() => {
            const status = document.querySelector("#status");
            const empty = document.querySelector("#empty");
            const ring = getComputedStyle(status, "::before");
            return {
              statusText: status.textContent,
              statusLabel: status.getAttribute("aria-label"),
              statusRingContent: ring.content,
              statusRingWidth: ring.width,
              statusRingAnimation: ring.animationName,
              statusRingColor: ring.backgroundColor,
              appInkColor: getComputedStyle(document.documentElement).color,
              emptyState: empty.dataset.state,
              emptyMessage: document.querySelector("#empty-message").textContent,
              emptyLogoHidden: document.querySelector("#empty-logo").hidden,
              scanOverlayHidden: document.querySelector("#scan-overlay").hidden,
              overlayRingWidth: getComputedStyle(document.querySelector("#scan-overlay"), "::before").width,
            };
          });
          assert.equal(spinnerState.statusText, "", `${caseName}: busy status should not render its message`);
          assert.equal(spinnerState.statusLabel, locale === "ja-JP" ? "ページを調べています…" : "Analyzing the page…", `${caseName}: busy status should remain accessible`);
          assert.notEqual(spinnerState.statusRingContent, "none", `${caseName}: busy status should show its spinner`);
          assert.equal(spinnerState.statusRingWidth, "22px", `${caseName}: status spinner should be compact`);
          assert.equal(spinnerState.statusRingColor, spinnerState.appInkColor, `${caseName}: spinner should follow the app ink color`);
          assert.equal(spinnerState.statusRingAnimation, "none", `${caseName}: reduced motion should stop spinner animation`);
          await page.emulateMedia({reducedMotion: "no-preference"});
          const movingSpinner = await page.locator("#status").evaluate(element => {
            const ring = getComputedStyle(element, "::before");
            return {animationName: ring.animationName, animationDuration: ring.animationDuration};
          });
          assert.notEqual(movingSpinner.animationName, "none", `${caseName}: spinner should animate when motion is allowed`);
          assert.equal(movingSpinner.animationDuration, "0.9s", `${caseName}: spinner should use the specified rotation interval`);
          await page.emulateMedia({reducedMotion: "reduce"});
          assert.equal(spinnerState.emptyState, "scanning", `${caseName}: empty results should expose scanning state`);
          assert.equal(spinnerState.emptyMessage, "", `${caseName}: scanning should hide the empty message`);
          assert.equal(spinnerState.emptyLogoHidden, true, `${caseName}: scanning should hide the logo`);
          assert.equal(spinnerState.scanOverlayHidden, false, `${caseName}: overlay should be visible while scanning`);
          assert.equal(spinnerState.overlayRingWidth, "64px", `${caseName}: scanning overlay ring should be large`);
          await page.evaluate(() => window.__releaseScanFixture());
          await page.waitForFunction(() => !document.querySelector("#scan").disabled);
          await page.waitForTimeout(280);
          assert.equal(await page.locator("#viewer").isVisible(), true, `${caseName}: successful scan opens viewer`);
          const stage = await page.locator("#viewer-stage").boundingBox();
          assert.ok(stage.width > 100 && stage.height > height * 0.45, `${caseName}: large image must use available space`);
          const firstResultCount = await page.locator("#images img").count();
          const secondPendingFixture = {...imageFixture(4, 1), pending: true};
          await page.evaluate(value => { window.__harvestScanFixture = value; }, secondPendingFixture);
          await page.locator("#scan").click();
          await page.waitForFunction(() => document.querySelector("#status").dataset.state === "busy");
          assert.equal(await page.locator("#scan-overlay").isHidden(), false, `${caseName}: overlay should cover thumbnails during re-analysis`);
          assert.equal(await page.locator("#images img").count(), firstResultCount, `${caseName}: thumbnails should remain present under the overlay`);
          await page.evaluate(() => window.__releaseScanFixture());
          await page.waitForFunction(() => !document.querySelector("#scan").disabled);
          assert.equal(await page.locator("#scan-overlay").isHidden(), true, `${caseName}: overlay should hide when re-analysis completes`);
          const sourceOption = page.locator(".source-page-option span");
          const originalOption = await sourceOption.textContent();
          await sourceOption.evaluate(element => { element.textContent = "出典ページの追加 Source page"; });
          const wrappedOption = await inspectLayout(page, width, height, `${caseName} wrapped source option`);
          assert.equal(wrappedOption.header.height, empty.header.height, `${caseName}: right-side options must not change header height`);
          await sourceOption.evaluate((element, text) => { element.textContent = text; }, originalOption);
          const few = await inspectLayout(page, width, height, `${caseName} few images`);
          assert.equal(few.header.height, empty.header.height, `${caseName}: image results must not change header height`);
          assert.equal(few.groupCount, 1, `${caseName}: fixture should create one group`);
          const allEye = page.locator("#all-visibility");
          const allSelection = page.locator("#all-selection");
          assert.equal(await allSelection.count(), 1, `${caseName}: toolbar needs an all-images PDF checkbox`);
          assert.equal(await page.locator("#groups .group-chip button svg.eye-icon").count(), few.groupCount,
            `${caseName}: every group row needs a visible eye icon`);
          await allEye.click();
          assert.equal(await page.locator("#images > li").count(), 0, `${caseName}: all-images eye hides the list`);
          assert.equal(await allEye.locator(".eye-slash").count(), 1, `${caseName}: hidden state needs a crossed eye`);
          await allEye.click();
          assert.equal(await page.locator("#images > li").count(), 4, `${caseName}: all-images eye restores the list`);
          await allSelection.uncheck();
          assert.equal(await page.locator("#export").isDisabled(), true, `${caseName}: all-images checkbox clears PDF selection`);
          await allSelection.check();
          assert.equal(await page.locator("#export").isDisabled(), false, `${caseName}: all-images checkbox selects PDF images`);
          await scan(page, imageFixture(120, 36));
          const many = await inspectLayout(page, width, height, `${caseName} many groups`);
          assert.equal(many.header.height, empty.header.height, `${caseName}: group count must not change header height`);
          assert.ok(many.groupCount >= 30, `${caseName}: many-group fixture should create at least 30 groups`);
          assert.ok(many.sidebar.scrollHeight > many.sidebar.clientHeight, `${caseName}: tall controls must scroll within right panel`);
          await page.locator(".workspace-sidebar").evaluate(element => { element.scrollTop = 0; });
          const scrollState = await page.locator(".workspace-sidebar").evaluate(element => {
            const start = element.scrollTop;
            const main = document.querySelector("main");
            element.scrollTop = element.scrollHeight;
            return {
              overflowY: getComputedStyle(element).overflowY,
              headerOverflow: getComputedStyle(document.querySelector(".app-header")).overflow,
              start,
              end: element.scrollTop,
              mainScrollTop: main.scrollTop,
            };
          });
          assert.equal(scrollState.overflowY, "auto", `${caseName}: right panel should own vertical scrolling`);
          assert.equal(scrollState.headerOverflow, "hidden", `${caseName}: the header itself must not scroll`);
          assert.equal(scrollState.start, 0, `${caseName}: group list should begin at the top`);
          assert.ok(scrollState.end > 0, `${caseName}: right panel should move when scrolled`);
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
