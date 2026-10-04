import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {serveExtension} from "./support/extension-files.mjs";
import {launchBrowser} from "./support/browser.mjs";
import {gifBytes, mp4Bytes} from "./media-fixtures.mjs";

function zipEntries(bytes) {
  const entries = [];
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    const size = bytes.readUInt32LE(offset + 22);
    const start = offset + 30 + bytes.readUInt16LE(offset + 26);
    entries.push({name: bytes.subarray(offset + 30, start).toString(), bytes: bytes.subarray(start, start + size)});
    offset = start + size;
  }
  return entries;
}

for (const language of ["ja", "en"]) test(`${language}: 元形式・推奨形式の表示と保存は選択中の種類に追従する`, async t => {
  const {url} = await serveExtension(t);
  const browser = await launchBrowser(t);
  const context = await browser.newContext({locale: language, reducedMotion: "reduce", acceptDownloads: true});
  await context.addInitScript(language => {
    const listeners = new Set(), downloads = new Map();
    let nextDownload = 1;
    window.completeFixtureDownload = filename => {
      for (const [id, item] of downloads) {
        if (item.filename !== filename || item.state !== "in_progress") continue;
        downloads.set(id, {...item, state: "complete"});
        for (const listener of listeners) listener({id, state: {current: "complete"}});
        break;
      }
    };
    window.chrome = {
      i18n: {getUILanguage: () => language},
      runtime: {onConnect: {addListener() {}}},
      tabs: {
        query: async () => [{id: 7, url: "https://source.example.test/gallery"}],
        get: async () => ({id: 7, url: "https://source.example.test/gallery"}),
        onRemoved: {addListener() {}, removeListener() {}},
      },
      scripting: {executeScript: async () => [{result: window.fixture}]},
      downloads: {
        async download({url, filename}) {
          const id = nextDownload++;
          downloads.set(id, {id, filename, state: "in_progress"});
          const link = document.createElement("a");
          link.href = url; link.download = filename; link.click();
          return id;
        },
        search: async ({id}) => downloads.has(id) ? [downloads.get(id)] : [],
        onChanged: {addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener)},
      },
    };
  }, language);
  const page = await context.newPage();
  page.on("download", async download => {
    await download.path();
    await page.evaluate(filename => window.completeFixtureDownload(filename), download.suggestedFilename());
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  assert.equal(new URL(page.url()).pathname, "/app/index.html");
  assert.match(await page.title(), /Harvest/);
  const jpeg = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 24;
    canvas.getContext("2d").fillRect(0, 0, 32, 24);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  }), "base64");
  await context.route("https://files.example.test/**", route => {
    const path = new URL(route.request().url()).pathname;
    const [body, contentType] = path.endsWith(".gif") ? [gifBytes, "image/gif"] : path.endsWith(".mp4") ? [mp4Bytes, "video/mp4"] : [jpeg, "image/jpeg"];
    return route.fulfill({status: 200, body, contentType, headers: {"access-control-allow-origin": "*", "content-length": String(body.length)}});
  });
  const image = {url: "https://files.example.test/photo.jpg", kind: "image"};
  const gif = {url: "https://files.example.test/animation.gif", kind: "gif"};
  const video = {url: "https://files.example.test/movie.mp4", kind: "video"};
  const scan = async media => {
    await page.evaluate(media => { window.fixture = {url: "https://source.example.test/gallery", title: "automatic", images: media.filter(item => item.kind === "image").map(item => item.url), media}; }, media);
    await page.locator("#scan").click();
    await page.waitForFunction(() => document.querySelector("#scan").dataset.scanning === "false" && !document.querySelector("#scan").disabled);
  };
  const save = async (format, filename) => {
    await page.locator((await page.locator("#image-export-formats").isHidden()) ? `#video-export-format-${format}` : `#export-format-${format}`).check();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), filename);
    const bytes = await readFile(await download.path());
    await page.waitForFunction(() => document.querySelector("#export").dataset.saving === "false");
    return bytes;
  };
  assert.equal(await page.locator("#export-original-extension").textContent(), "(—)");
  assert.equal(await page.locator("#export-format-recommend").isChecked(), true, "保存設定がなければ推奨を初期選択する");
  await scan([image]);
  assert.equal(await page.locator("#export-format-recommend").isChecked(), true, "解析後も動的な推奨形式を選択する");
  assert.equal(await page.locator("#export-original-extension").textContent(), "(JPG)");
  assert.equal(await page.locator("#export-recommend-extension").textContent(), "(JPG)");
  assert.equal(await page.locator('label:has(#export-format-original)').getAttribute("data-recommended"), "true");
  assert.match(await page.locator("#export-format-original").getAttribute("aria-description"), language === "ja" ? /各ファイルをそのまま残す/ : /keep each file unchanged/);
  assert.notEqual(await page.locator('label:has(#export-format-pdf)').getAttribute("data-recommended"), "true", "単独画像をシリーズPDFとして推奨しない");
  for (const [width, height] of [[1280, 800], [768, 600], [360, 640]]) {
    await page.setViewportSize({width, height});
    const layout = await page.locator("#image-export-formats").evaluate(group => {
      const auto = group.querySelector(".export-auto-formats").getBoundingClientRect();
      const explicit = group.querySelector(".export-explicit-formats").getBoundingClientRect();
      return {bottom: auto.bottom, top: explicit.top, overflow: group.scrollWidth - group.clientWidth,
        labels: [...group.querySelectorAll("label:not([hidden])")].map(label => ({text: label.textContent.trim(), scroll: label.scrollWidth, client: label.clientWidth}))};
    });
    assert.ok(layout.bottom <= layout.top, "元形式・推奨形式の下に従来の選択肢を置く");
    if (language === "ja") await page.screenshot({path: `/tmp/harvest-automatic-formats-${width}.png`});
    if (language === "ja" && width === 1280) await page.locator(".save-area").screenshot({path: "/tmp/harvest-format-choices.png"});
    assert.ok(layout.overflow <= 1 && layout.labels.every(label => label.scroll <= label.client + 1), `${width}: ラベルを見切れさせない ${JSON.stringify(layout)}`);
  }
  await page.locator("#export-format-original").check();
  assert.equal(await page.locator("#source-drop").textContent(), "automatic.jpg");
  assert.deepEqual(await save("original", "automatic.jpg"), jpeg, "元のJPEGをそのまま保存する");
  assert.deepEqual(await save("recommend", "automatic.jpg"), jpeg, "推奨でも単独JPEGを再変換せず保存する");
  await scan([gif]);
  assert.equal(await page.locator("#export-format-recommend").isChecked(), true);
  assert.equal(await page.locator("#export-recommend-extension").textContent(), "(GIF)");
  assert.deepEqual(await save("recommend", "automatic.gif"), gifBytes);
  await scan([video]);
  assert.equal(await page.locator("#video-export-format-recommend + span").textContent(), "recommended(MP4)");
  assert.deepEqual(await save("recommend", "automatic.mp4"), mp4Bytes);
  await scan([image, gif, video]);
  await page.locator("#all-selection").check();
  assert.equal(await page.locator("#export-recommend-extension").textContent(), language === "ja" ? "(混在)" : "(mixed)");
  const mixed = zipEntries(await save("recommend", "automatic.zip"));
  assert.deepEqual(mixed.map(entry => entry.name.split(".").pop()).sort(), ["gif", "jpg", "mp4"]);
  assert.deepEqual(mixed.find(entry => entry.name.endsWith(".jpg")).bytes, jpeg);
  assert.deepEqual(mixed.find(entry => entry.name.endsWith(".mp4")).bytes, mp4Bytes);
  assert.deepEqual(mixed.find(entry => entry.name.endsWith(".gif")).bytes, gifBytes);
  const originals = zipEntries(await save("original", "automatic.zip"));
  assert.deepEqual(originals.find(entry => entry.name.endsWith(".jpg")).bytes, jpeg);
  await page.reload();
  assert.equal(await page.locator("#export-format-recommend").isChecked(), true, "パネルを開き直すと推奨へ戻る");
  assert.equal(await page.locator("#video-export-format-recommend").isChecked(), true);
  assert.deepEqual(errors, []);
});
