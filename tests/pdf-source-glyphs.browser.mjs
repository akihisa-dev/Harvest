import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { chromium } from "playwright";

test("source characters outside Latin-1 become reusable visible PDF glyph images", async () => {
  const moduleSource = await readFile(new URL("../dist/extension/app/media/pdf-source-glyphs.js", import.meta.url), "utf8");
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    const glyphs = await page.evaluate(async source => {
      const moduleUrl = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
      try {
        const {prepareSourceGlyphs} = await import(moduleUrl);
        const images = await prepareSourceGlyphs(["資料📚", "https://example.test/📚/🧭"]);
        return Object.fromEntries(Object.entries(images).map(([character, image]) => [
          character, {width: image.width, height: image.height, rgbFlate: [...image.rgbFlate]},
        ]));
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    }, moduleSource);
    assert.deepEqual(Object.keys(glyphs).sort(), ["資", "料", "📚", "🧭"].sort());
    for (const glyph of Object.values(glyphs)) {
      const rgb = inflateSync(Buffer.from(glyph.rgbFlate));
      assert.equal(rgb.length, glyph.width * glyph.height * 3);
      assert.ok(rgb.some(channel => channel < 255), "the browser painted the character");
    }
  } finally {
    await browser.close();
  }
});
