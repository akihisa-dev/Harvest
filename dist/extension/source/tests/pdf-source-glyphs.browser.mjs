import {launchBrowser, startServer} from "./support/browser.mjs";
import {extensionFile} from "./support/extension-files.mjs";
import assert from "node:assert/strict";
import {inflateSync} from "node:zlib";
import test from "node:test";

test("source graphemes become reusable visible PDF images without splitting combining marks or emoji", async t => {
  const server = await startServer(t, async (request, response) => {
    if (request.url === "/") { response.writeHead(200, {"content-type": "text/html"}); response.end("<!doctype html><title>PDF fixture</title>"); return; }
    try {
      const file = await extensionFile(request.url);
      response.writeHead(200, {"content-type": file.contentType}); response.end(file.body);
    } catch { response.writeHead(404).end(); }
  });
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const {prepareSourceGlyphs} = await import("/app/media/pdf-source-glyphs.js");
    const {createPdfFromJpegs} = await import("/core/pdf.js");
    const {createSourcePreview} = await import("/app/panel/export-presentation.js");
    const filename = "A漢📚か\u3099👩‍💻葛\u{e0100}🇯🇵e\u0301.pdf";
    const painted = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      painted.push(text);
      return fillText.call(this, text, ...args);
    };
    let images;
    try { images = await prepareSourceGlyphs([filename, "https://example.test/📚/🧭"]); }
    finally { CanvasRenderingContext2D.prototype.fillText = fillText; }
    const pdf = createPdfFromJpegs([], {heading: "Source", filename, url: "https://example.test/", glyphs: images});
    const preview = createSourcePreview([{url: "https://example.test/a.jpg", sourcePage: "https://example.test/"}], "pdf", true, "Source", filename);
    return {
      painted, pdf: [...pdf], preview: decodeURIComponent(preview.url.split(",")[1]),
      glyphs: Object.fromEntries(Object.entries(images).map(([character, image]) => [
        character, {width: image.width, height: image.height, rgbFlate: [...image.rgbFlate]},
      ])),
    };
  });
  const units = ["漢", "📚", "か\u3099", "👩‍💻", "葛\u{e0100}", "🇯🇵", "e\u0301", "🧭"];
  assert.deepEqual(Object.keys(result.glyphs).sort(), [...units].sort());
  assert.deepEqual(result.painted, units, "Canvas receives each complete grapheme exactly once");
  for (const glyph of Object.values(result.glyphs)) {
    const rgb = inflateSync(Buffer.from(glyph.rgbFlate));
    assert.equal(rgb.length, glyph.width * glyph.height * 3);
    assert.ok(rgb.some(channel => channel < 255), "the browser painted the grapheme");
  }
  const pdf = Buffer.from(result.pdf).toString("latin1");
  assert.match(pdf, /<304b3099>/, "PDF copy text keeps decomposed Japanese");
  assert.match(pdf, /<d83ddc69200dd83ddcbb>/, "PDF copy text keeps the joined emoji");
  assert.ok(result.preview.includes("A漢📚か\u3099👩‍💻葛\u{e0100}🇯🇵e\u0301.pdf"));
  assert.ok(result.preview.includes('textLength="120.000"'), "preview uses the same grapheme widths as PDF");
});
