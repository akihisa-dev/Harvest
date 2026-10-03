import {startServer, launchBrowser} from "./support/browser.mjs";
import assert from "node:assert/strict";
import {createReadStream} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import test from "node:test";

test("空状態のロゴと文言は読み上げを即時更新しながら連続遷移する", async (t) => {
  const extensionRoot = resolve(process.env.HARVEST_TEST_EXTENSION_DIR ?? fileURLToPath(new URL("../dist/extension/", import.meta.url)));
  const extensionUrl = pathToFileURL(`${extensionRoot}/`);
  const files = new Map([
    ["/empty-state.js", new URL("app/panel/empty-state.js", extensionUrl)],
    ["/motion.js", new URL("app/panel/motion.js", extensionUrl)],
    ["/style.css", new URL("app/style.css", extensionUrl)],
  ]);
  const server = await startServer(t, (request, response) => {
    if (request.url === "/") {
      response.writeHead(200, {"Content-Type": "text/html; charset=utf-8"}).end(`<!doctype html>
        <link rel="stylesheet" href="/style.css">
        <main><div id="empty"><img id="empty-logo" alt="Harvest"><p id="empty-message" role="status" aria-live="polite" aria-atomic="true"></p></div>
        <div id="scan-overlay" hidden></div><ol id="images"><li id="retained-image">image</li></ol></main>`);
      return;
    }
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const file = files.get(path);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", path.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
    createReadStream(file).pipe(response);
  });

  const address = server.address();
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.emulateMedia({reducedMotion: "no-preference"});
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const transitions = await page.evaluate(async () => {
    const {createEmptyStateView} = await import("/empty-state.js");
    const logo = document.querySelector("#empty-logo");
    const message = document.querySelector("#empty-message");
    const overlay = document.querySelector("#scan-overlay");
    const update = createEmptyStateView({container: document.querySelector("#empty"), logo, message});
    window.emptyStateTestUpdate = update;
    const finishAnimations = async () => {
      const animations = [...logo.getAnimations(), ...message.getAnimations({subtree: true})];
      for (const animation of animations) animation.finish();
      await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    };

    update("initial", "", "");
    update("scanning", "", "Analyzing the page…");
    overlay.hidden = false;
    const logoExit = logo.getAnimations().at(-1);
    logoExit.pause();
    logoExit.currentTime = 50;
    const scanning = {
      logoOpacity: Number(getComputedStyle(logo).opacity),
      announcement: message.getAttribute("aria-label"),
      live: message.getAttribute("aria-live"),
      overlayZ: Number(getComputedStyle(overlay).zIndex),
    };
    await finishAnimations();
    update("empty", "No images were found.", "No images were found.");
    overlay.hidden = true;
    await finishAnimations();
    const empty = {
      message: message.querySelector(".empty-message__current").textContent,
      logoHidden: logo.getAttribute("aria-hidden"),
    };
    update("scanning", "", "Analyzing the page…");
    const oldMessageLayer = [...message.querySelectorAll(".empty-message__outgoing")].find(element => element.textContent === "No images were found.");
    const oldMessageAnimation = oldMessageLayer.getAnimations().at(-1);
    oldMessageAnimation.pause();
    oldMessageAnimation.currentTime = 55;
    update("error", "The page could not be analyzed.", "The page could not be analyzed.");
    const incomingError = message.querySelector(".empty-message__current").getAnimations().at(-1);
    incomingError.pause();
    incomingError.currentTime = 55;
    const duringError = {
      announcement: message.getAttribute("aria-label"),
      current: message.querySelector(".empty-message__current").textContent,
      outgoing: [...message.querySelectorAll(".empty-message__outgoing")].map(element => ({
        text: element.textContent,
        hidden: element.getAttribute("aria-hidden"),
        opacity: Number(getComputedStyle(element).opacity),
      })),
      retainedImage: Boolean(document.querySelector("#retained-image")),
    };
    let maxOutgoing = 0;
    for (let index = 0; index < 8; index += 1) {
      update("scanning", "", "Analyzing the page…");
      update(index % 2 ? "empty" : "error", index % 2 ? "No images were found." : "The page could not be analyzed.", index % 2 ? "No images were found." : "The page could not be analyzed.");
      maxOutgoing = Math.max(maxOutgoing, message.querySelectorAll(".empty-message__outgoing").length);
    }
    await finishAnimations();
    return {scanning, empty, duringError, maxOutgoing, outgoingAfter: message.querySelectorAll(".empty-message__outgoing").length};
  });

  assert.ok(transitions.scanning.logoOpacity > 0 && transitions.scanning.logoOpacity < 1, "解析中にロゴが途中の濃さを通る");
  assert.equal(transitions.scanning.announcement, "Analyzing the page…");
  assert.equal(transitions.scanning.live, "polite");
  assert.equal(transitions.scanning.overlayZ, 2, "解析オーバーレイは空状態より前面にある");
  assert.equal(transitions.empty.message, "No images were found.");
  assert.equal(transitions.empty.logoHidden, "true");
  assert.equal(transitions.duringError.announcement, "The page could not be analyzed.");
  assert.equal(transitions.duringError.current, "The page could not be analyzed.");
  assert.ok(transitions.duringError.outgoing.some(layer => layer.text === "No images were found." && layer.hidden === "true"), "前の文言は読み上げ対象から外してフェードする");
  const previousMessage = transitions.duringError.outgoing.find(layer => layer.text === "No images were found.");
  assert.ok(previousMessage.opacity > 0 && previousMessage.opacity < 1, "遷移途中から次の状態へつなぐ");
  assert.ok(transitions.duringError.retainedImage, "空状態の切替は画像一覧に触れない");
  assert.ok(transitions.maxOutgoing <= 3, "短時間の状態切替で退場文言を3層以内に保つ");
  assert.equal(transitions.outgoingAfter, 0);

  await page.evaluate(() => {
    window.emptyStateTestUpdate("scanning", "", "Analyzing the page…");
    window.emptyStateTestUpdate("error", "The page could not be analyzed.", "The page could not be analyzed.");
  });
  await page.emulateMedia({reducedMotion: "reduce"});
  const reduced = await page.evaluate(async () => {
    const logo = document.querySelector("#empty-logo");
    const message = document.querySelector("#empty-message");
    window.emptyStateTestUpdate("error", "The page could not be analyzed.", "The page could not be analyzed.");
    return {
      animations: logo.getAnimations().length + message.getAnimations({subtree: true}).length,
      details: [...logo.getAnimations(), ...message.getAnimations({subtree: true})].map(animation => ({target: animation.effect?.target?.className ?? animation.effect?.target?.id, state: animation.playState})),
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      text: message.querySelector(".empty-message__current").textContent,
    };
  });
  assert.equal(reduced.animations, 0, "動きを減らす設定ではアニメーションを作らない");
  assert.equal(reduced.text, "The page could not be analyzed.");
});
