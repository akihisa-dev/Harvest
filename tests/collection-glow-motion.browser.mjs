import {startServer, launchBrowser} from "./support/browser.mjs";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function serve(t, modulePath) {
  const server = await startServer(t, async (request, response) => {
    if (request.url === "/collection-mode.js") {
      response.writeHead(200, {"content-type": "text/javascript; charset=utf-8"});
      response.end(await readFile(modulePath));
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, {"content-type": "text/html; charset=utf-8"});
      response.end(`<!doctype html><meta charset="utf-8"><style>
        body { margin: 0; height: 100vh; }
        a { position: fixed; display: block; width: 120px; height: 50px; background: #333; color: white; }
        #first { left: 60px; top: 60px; }
        #second { left: 300px; top: 60px; }
      </style><a id="first" href="/first">first</a><a id="second" href="/second">second</a>
      <script type="module">
        const port = {
          onMessage: {addListener(listener) { port.receive = listener; }},
          onDisconnect: {addListener(listener) { port.onClose = listener; }},
          postMessage(message) { window.lastMessage = message; },
        };
        window.chrome = {runtime: {connect() { return port; }}};
        window.testPort = port;
        const {captureCollectionLinks} = await import("/collection-mode.js");
        captureCollectionLinks("browser-test");
        window.collectionReady = true;
      </script>`);
      return;
    }
    response.writeHead(404).end();
  });

  return {server, url: `http://127.0.0.1:${server.address().port}/`};
}

test("収集発光は出入りと状態を滑らかにつなぎ、追従を遅らせず終了時に片付く", async (t) => {
  const modulePath = join(root, "dist/extension/app/content/collection-mode.js");
  const {server, url} = await serve(t, modulePath);
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.collectionReady === true);

  await page.mouse.move(70, 70);
  const hoverSelector = "[data-harvest-collection-hover]:not([data-harvest-collection-motion-ghost])";
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-harvest-collection-hover]:not([data-harvest-collection-motion-ghost])");
    return element?.style.display === "block" && element.getAnimations().some(animation => animation.transitionProperty === "opacity");
  });
  const entry = await page.locator(hoverSelector).evaluate(element => ({
    left: element.style.left,
    display: element.style.display,
    opacity: (() => {
      const animation = element.getAnimations().find(candidate => candidate.transitionProperty === "opacity");
      animation?.finish();
      return getComputedStyle(element).opacity;
    })(),
    transitionProperty: getComputedStyle(element).transitionProperty,
    pointerEvents: getComputedStyle(element).pointerEvents,
  }));
  assert.equal(entry.display, "block", JSON.stringify(entry));
  assert.ok(Number(entry.opacity) > .95, JSON.stringify(entry));
  assert.equal(entry.left, "60px");
  assert.doesNotMatch(entry.transitionProperty, /left|top|width|height/, "位置と寸法はtransitionしない");
  assert.equal(entry.pointerEvents, "none");

  await page.mouse.click(70, 70);
  await page.waitForFunction(() => Boolean(window.lastMessage?.url));
  await page.evaluate(() => window.testPort.receive({busy: false, pdfUrl: new URL("/first", location.href).href, canExport: false}));
  const sameTarget = await page.locator(hoverSelector).evaluate(element => ({
    ghosts: document.querySelectorAll("[data-harvest-collection-motion-ghost]").length,
    opacity: Number(getComputedStyle(element).opacity),
    markerOpacity: Number(getComputedStyle(document.querySelector("[data-harvest-collection-marker]")).opacity),
  }));
  assert.equal(sameTarget.ghosts, 0, "同じ対象のfade復帰ではghostを複製しない");
  assert.ok(sameTarget.opacity > 0, "同じ対象のfade復帰は現在の見た目から続ける");
  assert.ok(sameTarget.markerOpacity < 1, `解析済みマーカーは初期opacityから現れます (${sameTarget.markerOpacity})`);
  await page.waitForFunction(() => document.querySelector("[data-harvest-collection-marker]").getAnimations().some(animation => animation.transitionProperty === "opacity"));
  const earlyMarkerMidpoint = await page.locator("[data-harvest-collection-marker]").evaluate(element => {
    const transition = element.getAnimations().find(animation => animation.transitionProperty === "opacity");
    transition.pause();
    transition.currentTime = 90;
    const opacity = Number(getComputedStyle(element).opacity);
    transition.finish();
    return opacity;
  });
  assert.ok(earlyMarkerMidpoint > 0 && earlyMarkerMidpoint < 1, `解析済みマーカーの初回表示もopacityの中間値を通ります (${earlyMarkerMidpoint})`);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector("[data-harvest-collection-hover]:not([data-harvest-collection-motion-ghost])")).opacity) > .95);

  await page.mouse.move(310, 70);
  const retargeted = await page.locator(hoverSelector).evaluate(element => ({
    left: element.style.left,
    opacity: Number(getComputedStyle(element).opacity),
    ghosts: document.querySelectorAll("[data-harvest-collection-motion-ghost]").length,
    ghostLeft: document.querySelector("[data-harvest-collection-motion-ghost]")?.style.left,
  }));
  assert.equal(retargeted.left, "300px", "新しい対象の座標はすぐ反映する");
  assert.ok(retargeted.opacity < 1, `新しい対象は透明から現れます (${retargeted.opacity})`);
  assert.equal(retargeted.ghosts, 1, "旧対象の発光を別要素で短く消す");
  assert.equal(retargeted.ghostLeft, "60px");
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-harvest-collection-hover]:not([data-harvest-collection-motion-ghost])");
    getComputedStyle(element).opacity;
    return element.getAnimations().some(animation => animation.transitionProperty === "opacity");
  });
  const hoverMidpoint = await page.locator(hoverSelector).evaluate(element => {
    const transition = element.getAnimations().find(animation => animation.transitionProperty === "opacity");
    if (!transition) return null;
    transition.pause();
    transition.currentTime = 80;
    return Number(getComputedStyle(element).opacity);
  });
  assert.ok(hoverMidpoint > 0 && hoverMidpoint < 1, `新しい対象はopacityの中間値を通ります (${hoverMidpoint})`);
  await page.locator(hoverSelector).evaluate(element => element.getAnimations().find(animation => animation.transitionProperty === "opacity")?.finish());
  await page.evaluate(() => {
    for (let index = 0; index < 8; index += 1) {
      document.querySelector(index % 2 ? "#first" : "#second").dispatchEvent(new PointerEvent("pointermove", {bubbles: true}));
    }
  });
  assert.ok(await page.locator("[data-harvest-collection-motion-ghost]").count() <= 3, "高速切替でも残像は3個まで");

  await page.mouse.move(700, 500);
  await page.waitForFunction(() => document.querySelector("[data-harvest-collection-hover]:not([data-harvest-collection-motion-ghost])").style.display === "none");

  await page.mouse.click(70, 70);
  await page.waitForFunction(() => window.lastMessage?.url === new URL("/first", location.href).href);
  await page.evaluate(() => window.testPort.receive({busy: false, pdfUrl: new URL("/first", location.href).href, canExport: false}));
  const marker = page.locator("[data-harvest-collection-marker]");
  await marker.waitFor();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector("[data-harvest-collection-marker]")).opacity) > .95);
  await page.waitForFunction(() => !document.querySelector("[data-harvest-collection-marker]").getAnimations().some(animation => animation.transitionProperty === "box-shadow"));
  const cyanShadow = await marker.evaluate(element => getComputedStyle(element).boxShadow);
  await page.evaluate(() => window.testPort.receive({canExport: true}));
  assert.ok(await marker.evaluate(element => element.getAnimations().length > 0), "色昇格を連続的に変える");
  assert.match(await marker.evaluate(element => getComputedStyle(element).transitionProperty), /box-shadow/);
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-harvest-collection-marker]");
    getComputedStyle(element).boxShadow;
    return element.getAnimations().some(animation => animation.transitionProperty === "box-shadow");
  });
  const goldMidpoint = await marker.evaluate(element => {
    const transition = element.getAnimations().find(animation => animation.transitionProperty === "box-shadow");
    if (!transition) return null;
    transition.pause();
    transition.currentTime = 90;
    const middle = getComputedStyle(element).boxShadow;
    transition.finish();
    return {middle, final: getComputedStyle(element).boxShadow};
  });
  assert.ok(goldMidpoint && goldMidpoint.middle !== cyanShadow && goldMidpoint.middle !== goldMidpoint.final, `cyanからgoldの途中色を通ります: ${cyanShadow} -> ${JSON.stringify(goldMidpoint)}`);

  await page.waitForFunction(() => document.querySelector("[data-harvest-collection-hover]:not([data-harvest-collection-motion-ghost])").style.boxShadow.includes("255, 235, 140"));
  await page.locator("#first").evaluate(element => element.setAttribute("href", "/replacement"));
  // Wait for the new URL's target style, not a rounded color on the previous transition.
  await page.waitForFunction(() => document.querySelector("[data-harvest-collection-hover]:not([data-harvest-collection-motion-ghost])").style.boxShadow.includes("125, 235, 255"));
  const changedHoverShadow = await page.locator(hoverSelector).evaluate(element => {
    getComputedStyle(element).boxShadow;
    for (const animation of element.getAnimations()) {
      if (animation.transitionProperty === "box-shadow") animation.finish();
    }
    return getComputedStyle(element).boxShadow;
  });
  assert.ok(changedHoverShadow.includes("125, 235, 255"), `href変更後のhover色は新しいURLの状態へ戻る: ${changedHoverShadow}`);
  await page.waitForFunction(() => document.querySelector("[data-harvest-collection-marker]") === null);

  await page.emulateMedia({reducedMotion: "reduce"});
  await page.mouse.move(700, 500);
  await page.mouse.move(70, 70);
  const reduced = await page.locator(hoverSelector).evaluate(element => ({
    opacity: getComputedStyle(element).opacity,
    transition: getComputedStyle(element).transitionDuration,
  }));
  assert.equal(reduced.opacity, "1");
  assert.equal(reduced.transition, "0s");

  await page.mouse.click(70, 70);
  await page.evaluate(() => window.testPort.receive({busy: false, pdfUrl: new URL("/replacement", location.href).href, canExport: false}));
  await page.locator("[data-harvest-collection-marker]").waitFor();
  assert.equal(await page.locator("[data-harvest-collection-marker]").evaluate(element => getComputedStyle(element).transitionDuration), "0s");

  await page.emulateMedia({reducedMotion: "no-preference"});
  await page.mouse.move(700, 500);
  await page.mouse.move(70, 70);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector("[data-harvest-collection-hover]:not([data-harvest-collection-motion-ghost])")).opacity) > .95);
  await page.evaluate(() => window.testPort.onClose());
  const overlays = page.locator("[data-harvest-collection-hover], [data-harvest-collection-marker], [data-harvest-collection-motion-ghost]");
  assert.ok(await overlays.count() >= 2, "通常設定では切断直後に出入りを継続する");
  await page.waitForFunction(() => document.querySelectorAll("[data-harvest-collection-hover], [data-harvest-collection-marker], [data-harvest-collection-motion-ghost]").length === 0);

  const reducedPage = await browser.newPage();
  await reducedPage.emulateMedia({reducedMotion: "reduce"});
  await reducedPage.goto(url);
  await reducedPage.waitForFunction(() => window.collectionReady === true);
  await reducedPage.mouse.move(70, 70);
  await reducedPage.mouse.click(70, 70);
  await reducedPage.evaluate(() => window.testPort.receive({busy: false, pdfUrl: new URL("/first", location.href).href, canExport: false}));
  await reducedPage.locator("[data-harvest-collection-marker]").waitFor();
  await reducedPage.evaluate(() => window.testPort.onClose());
  assert.equal(await reducedPage.locator("[data-harvest-collection-hover], [data-harvest-collection-marker], [data-harvest-collection-motion-ghost]").count(), 0, "動きを減らす設定では切断時に即時片付ける");
});
