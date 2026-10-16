import assert from "node:assert/strict";
import test from "node:test";
import {launchBrowser, startServer} from "./support/browser.mjs";
import {extensionFile} from "./support/extension-files.mjs";

test("RTL行はブラウザーの文字組みを共有し、Latin・数字を反転せず論理文字列を保持する", async t => {
  const server = await startServer(t, async (request, response) => {
    if (request.url === "/") {response.writeHead(200, {"content-type": "text/html"}); response.end("<!doctype html>"); return;}
    try {const file = await extensionFile(request.url); response.writeHead(200, {"content-type": file.contentType}); response.end(file.body);}
    catch {response.writeHead(404).end();}
  });
  const browser = await launchBrowser(t), page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const results = await page.evaluate(async () => {
    const {prepareSourcePageText} = await import("/app/media/pdf-source-glyphs.js");
    const {createPdfFromJpegs, createSourcePageLayout} = await import("/core/pdf.js");
    const {createSourcePreview} = await import("/app/panel/export-presentation.js");
    const results = [];
    for (const filename of ["שלום", "שלום.pdf", "report 123 שלום 45.pdf", "مرحبا 123 report.pdf", "שלום 123 ".repeat(20) + "か\u3099👩‍💻.pdf"]) {
      const source = {heading: "Source", filename, url: "https://example.test/"};
      const painted = [], fillText = CanvasRenderingContext2D.prototype.fillText;
      let prepared;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {painted.push(text); return fillText.call(this, text, ...args);};
      try {prepared = await prepareSourcePageText(source);} finally {CanvasRenderingContext2D.prototype.fillText = fillText;}
      const layout = createSourcePageLayout(source);
      const preview = createSourcePreview([{url: "https://example.test/a.jpg", sourcePage: source.url}], "pdf", true, source.heading, filename);
      const svg = new DOMParser().parseFromString(decodeURIComponent(preview.url.split(",")[1]), "image/svg+xml");
      const lines = [];
      for (const [text, image] of Object.entries(prepared.lineImages)) {
        const bytes = new Uint8Array(await new Response(new Blob([image.rgbFlate]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
        lines.push({text, width: image.width, height: image.height, painted: painted.includes(text), visible: bytes.some(channel => channel < 255)});
      }
      const pdf = new TextDecoder("latin1").decode(createPdfFromJpegs([], {...source,...prepared}));
      results.push({filename, lines, layout: layout.lines.filter(line => line.size === 12).map(line => line.text),
        preview: [...svg.querySelectorAll('text[font-family]')].map(element => ({text: element.textContent, font: element.getAttribute('font-family')})),
        draws: (pdf.match(/\/Subtype \/Type3/g) ?? []).length});
    }
    return results;
  });
  for (const result of results) {
    assert.equal(result.lines.map(line => line.text).join(""), result.filename);
    assert.deepEqual(result.preview.map(line => line.text), result.layout);
    assert.equal(result.draws, result.lines.length, "RTL行は字形別の画像配置へ戻らない");
    for (const line of result.lines) {
      assert.equal(line.painted, true); assert.equal(line.visible, true);
      assert.ok(line.width <= 4096 && line.height === 128);
    }
    assert.ok(result.preview.every(line => line.font.includes("sans-serif")));
  }
});


test("Chrome内蔵PDFビューアーでRTL・英字・数字・結合文字・絵文字を元の文字列として選択できる", async t => {
  const pdfs = new Map();
  const server = await startServer(t, async (request, response) => {
    const pdf = pdfs.get(request.url);
    if (pdf) {response.writeHead(200, {"content-type": "application/pdf"}); response.end(pdf); return;}
    if (request.url === "/") {response.writeHead(200, {"content-type": "text/html"}); response.end("<!doctype html>"); return;}
    try {const file = await extensionFile(request.url); response.writeHead(200, {"content-type": file.contentType}); response.end(file.body);}
    catch {response.writeHead(404).end();}
  });
  const browser = await launchBrowser(t), page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const samples = await page.evaluate(async () => {
    const {prepareSourcePageText} = await import("/app/media/pdf-source-glyphs.js");
    const {createPdfFromJpegs, createSourcePageLayout} = await import("/core/pdf.js");
    const samples = [];
    for (const filename of ["שלום", "שלום.pdf", "report 123 שלום 45.pdf", "مرحبا 123 report.pdf",
      "日本語 か\u3099👩‍💻 שלום123.pdf", "שלום (123).pdf", "שלום(עולם).pdf", "שָׁלוֹם.pdf",
      "مرحبا(العالم).pdf", "שלום 💻👩‍💻.pdf", "שלום 123", "مرحبا ١٢٣ test.pdf", "שלום / עולם", "(שלום).pdf",
      "日本語 か\u3099👩‍💻.pdf", "שלום 123 ".repeat(15) + "report.pdf", "שלום\nمرحبا 123.pdf"]) {
      const source = samples.length === 0
        ? {heading: "שלום", filename, url: "https://example.test/שלום/مرحبا/123"}
        : {heading: "Source", filename, url: "https://example.test/"};
      const prepared = await prepareSourcePageText(source);
      samples.push({filename, bytes: [...createPdfFromJpegs([], {...source, ...prepared})],
        expected: createSourcePageLayout(source).lines.map(line => line.text).join("\n")});
    }
    return samples;
  });
  for (const [index, sample] of samples.entries()) {
    const path = `/source-${index}.pdf`;
    pdfs.set(path, Buffer.from(sample.bytes));
    const viewer = await browser.newPage();
    try {
      await viewer.goto(origin + path);
      // Inspect the same native plugin that handles user selection and Copy.
      // This does not touch the user's clipboard or their browser profile.
      let pluginFrame;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        pluginFrame = viewer.frames().find(frame => frame !== viewer.mainFrame() && frame.url() === origin + path);
        if (pluginFrame && await pluginFrame.locator('embed[type="application/x-google-chrome-pdf"]').count()) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(pluginFrame, "Chrome内蔵のPDFプラグインを起動する");
      await pluginFrame.waitForFunction(() => typeof document.querySelector("embed")?.postMessage === "function");
      let selected = "";
      for (let attempt = 0; attempt < 20; attempt += 1) {
        selected = await pluginFrame.evaluate(() => new Promise((resolve, reject) => {
          const plugin = document.querySelector("embed");
          const timeout = setTimeout(() => {plugin.removeEventListener("message", receive); reject(new Error("PDF selection timed out"));}, 5000);
          function receive(event) {
            if (event.data.type !== "getSelectedTextReply" || event.data.messageId !== "harvest-copy-test") return;
            clearTimeout(timeout); plugin.removeEventListener("message", receive); resolve(event.data.selectedText);
          }
          plugin.addEventListener("message", receive);
          plugin.postMessage({type: "selectAll"});
          plugin.postMessage({type: "getSelectedText", messageId: "harvest-copy-test"});
        }));
        if (selected) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(selected.replace(/\r\n/g, "\n"), sample.expected, sample.filename);
      if (index === 0) {
        await viewer.mouse.click(700, 500);
        const png = await viewer.screenshot({clip: {x: 300, y: 110, width: 500, height: 180}});
        const darkPixels = await page.evaluate(async base64 => {
          const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset] < 100 && pixels[offset + 1] < 100 && pixels[offset + 2] < 100) count += 1;
          }
          return count;
        }, png.toString("base64"));
        assert.ok(darkPixels > 30, "RTL行の字形画像がChromeのPDFページ内に描画され、白紙にならない");
      }
    } finally {await viewer.close();}
  }
});
