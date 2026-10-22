import assert from 'node:assert/strict';
import test from 'node:test';
import {exportFileBaseName, createSourcePreview, createExportPresentation} from '../dist/extension/app/panel/export-presentation.js';
import {individualFilename} from '../dist/extension/core/export-files.js';

test('保存名のUnicode境界・先頭ドット・空白・制御文字を正規化する', () => {
  for (const [title, expected] of [
    ['あ'.repeat(99) + '😀後続', 'あ'.repeat(66)],
    ['あ'.repeat(98) + '😀後続', 'あ'.repeat(66)],
    ['😀'.repeat(60), '😀'.repeat(50)],
    ['日本語'.repeat(50), '日本語'.repeat(22)],
  ['a'.repeat(98) + '🇯🇵', 'a'.repeat(98)],
  ['a'.repeat(96) + '🇯🇵後続', 'a'.repeat(96) + '🇯🇵'],
  ['a'.repeat(99) + 'か\u3099', 'a'.repeat(99)],
  ['a'.repeat(98) + 'か\u3099後続', 'a'.repeat(98) + 'か\u3099'],
  ['a'.repeat(94) + '👨‍👩‍👧‍👦', 'a'.repeat(94)],
  ['a'.repeat(89) + '👨‍👩‍👧‍👦後続', 'a'.repeat(89) + '_'],
  ['a'.repeat(99) + '\ud800', 'a'.repeat(99) + '�'],
    ['.leading', 'leading'], ['trailing.', 'trailing'], [' .名前. ', '名前'],
    ['...', 'Harvest'], ['   ', 'Harvest'], ['', 'Harvest'],
    ['A/B:C*D?E"F<G>H|I', 'A_B_C_D_E_F_G_H_I'],
    ['制御\u0000\n\u007f文字', '制御___文字'],
    ['first\u0085second', 'first_second'],
    ['非文字\ufdd0\ufffe\uffff\u{1fffe}\u{10ffff}末尾', '非文字_____末尾'],
    ['a'.repeat(99) + '\u{10ffff}', 'a'.repeat(99) + '_'],
    ['許可\u00a0\u2028\u2029😀文字', '許可\u00a0\u2028\u2029😀文字'],
    ['片側\ud83d末尾\udc00', '片側�末尾�'],
    ['x'.repeat(99) + '.後続', 'x'.repeat(99)],
  ]) {
    const base = exportFileBaseName(title, 'Harvest');
    assert.equal(base, expected);
    assert.ok(base.isWellFormed());
    assert.ok(base.length <= 100);
    assert.equal(individualFilename(base + '.zip', '001.mp4', 1), base + '.mp4');
    assert.equal(individualFilename(base + '.zip', '002.mp4', 3), base + '_002.mp4');
    for (const format of ['pdf', 'jpg', 'png', 'jxl', 'gif'])
      assert.equal(individualFilename(base + '.zip', '001.' + format, 1), base + '.' + format);
    const source = createSourcePreview([{url: 'https://example.test/a.png', sourcePage: 'https://example.test/gallery'}], 'pdf', true, 'Source', base + '.pdf');
    assert.ok(decodeURIComponent(source.url).replace(/<[^>]*>/g, '').includes(base + '.pdf'));
  }
  assert.equal(exportFileBaseName('...', '画像'), '画像');
  assert.equal(exportFileBaseName('...', '...'), 'Harvest');
});

test('C1制御文字と全Unicode非文字を置換し、予告名とPDF出典の名前を一致させる', () => {
  const points = [
    ...Array.from({length: 32}, (_, index) => 0x80 + index),
    ...Array.from({length: 32}, (_, index) => 0xfdd0 + index),
    ...Array.from({length: 17}, (_, plane) => [plane * 0x10000 + 0xfffe, plane * 0x10000 + 0xffff]).flat(),
  ];
  const image = {url: 'https://example.test/a.png', sourcePage: 'https://example.test/gallery', selected: true};
  for (const point of points) {
    const title = `first${String.fromCodePoint(point)}second`;
    assert.equal(exportFileBaseName(title, 'Harvest'), 'first_second', point.toString(16));
    assert.equal(exportFileBaseName('', title), 'first_second', 'fallback title uses the same rules');
    const presentation = createExportPresentation({getTitle: () => title,
      getSelection: () => ({format: 'pdf', videoFormat: 'mp4', includeSourcePage: true, selected: [image]}),
      fallbackTitle: 'Harvest', sourceHeading: 'Source'});
    assert.equal(presentation.resultFilename, 'first_second.pdf');
    assert.equal(presentation.pdfFilename, 'first_second.pdf');
    assert.equal(presentation.zipFilename, 'first_second.zip');
    assert.ok(decodeURIComponent(presentation.sourcePreview.url).replace(/<[^>]*>/g, '').includes('first_second.pdf'));
  }
});
