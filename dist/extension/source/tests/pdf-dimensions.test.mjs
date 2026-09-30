import assert from "node:assert/strict";
import test from "node:test";
import {createPdfFromJpegs} from "../dist/extension/core/pdf.js";

const decode = bytes => new TextDecoder().decode(bytes);

function readFirstImagePage(pdf) {
  const source = decode(pdf);
  const page = source.match(/\/Type \/Page \/Parent 2 0 R \/MediaBox \[0 0 ([^ ]+) ([^\]]+)\]/);
  assert.ok(page, "the first page has a MediaBox");
  const mediaWidth = Number(page[1]);
  const mediaHeight = Number(page[2]);
  const contents = source.match(/4 0 obj\n<< \/Length \d+ >>\nstream\n([^]*?)endstream/);
  assert.ok(contents, "the first image page has a content stream");
  const matrix = contents[1].match(/q\n([^ ]+) 0 0 ([^ ]+) 0 0 cm/);
  assert.ok(matrix, "the content stream draws the image using a scale matrix");
  const image = source.match(/\/Subtype \/Image \/Width (\d+) \/Height (\d+)/);
  assert.ok(image, "the image object retains intrinsic pixel dimensions");
  return {
    mediaWidth,
    mediaHeight,
    matrixWidth: Number(matrix[1]),
    matrixHeight: Number(matrix[2]),
    pixelWidth: Number(image[1]),
    pixelHeight: Number(image[2]),
    source,
  };
}

test("画像辺が14,400以下なら既存のページ寸法を維持する", () => {
  const page = readFirstImagePage(createPdfFromJpegs([
    {jpeg: new Uint8Array([1]), width: 14_400, height: 7_200},
  ]));

  assert.deepEqual(
    [page.mediaWidth, page.mediaHeight, page.matrixWidth, page.matrixHeight],
    [14_400, 7_200, 14_400, 7_200],
  );
  assert.deepEqual([page.pixelWidth, page.pixelHeight], [14_400, 7_200]);
});

test("14,400を1画素超える画像は比率を保ってMediaBoxと描画行列を縮尺する", () => {
  const page = readFirstImagePage(createPdfFromJpegs([
    {jpeg: new Uint8Array([2]), width: 14_401, height: 7_200},
  ]));

  assert.equal(page.mediaWidth, 14_400);
  assert.equal(page.matrixWidth, 14_400);
  assert.equal(page.mediaHeight, page.matrixHeight);
  assert.ok(page.mediaHeight <= 14_400);
  assert.ok(Math.abs(page.mediaWidth / page.mediaHeight - 14_401 / 7_200) < 1e-12);
  assert.deepEqual([page.pixelWidth, page.pixelHeight], [14_401, 7_200]);
});

test("16,384画素でも画像データを維持し、Sourceページ付きPDFの寸法を制限する", () => {
  const page = readFirstImagePage(createPdfFromJpegs([
    {jpeg: new Uint8Array([3]), width: 16_384, height: 8_192},
  ], {heading: "Source", filename: "image.jpg", url: "https://example.test/image.jpg"}));

  assert.match(page.source, /^%PDF-1\.5/);
  assert.equal(page.mediaWidth, 14_400);
  assert.equal(page.mediaHeight, 7_200);
  assert.equal(page.matrixWidth, 14_400);
  assert.equal(page.matrixHeight, 7_200);
  assert.deepEqual([page.pixelWidth, page.pixelHeight], [16_384, 8_192]);
  assert.match(page.source, /\/Type \/Page \/Parent 2 0 R \/MediaBox \[0 0 595 842\]/);
});
