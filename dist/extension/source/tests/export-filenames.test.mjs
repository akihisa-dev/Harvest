import assert from 'node:assert/strict';
import test from 'node:test';
import {exportFileBaseName, createSourcePreview} from '../dist/extension/app/panel/export-presentation.js';
import {individualFilename} from '../dist/extension/core/export-files.js';

test('保存名のUnicode境界・先頭ドット・空白・制御文字を正規化する', () => {
  for (const [title, expected] of [
    ['あ'.repeat(99) + '😀後続', 'あ'.repeat(99)],
    ['あ'.repeat(98) + '😀後続', 'あ'.repeat(98) + '😀'],
    ['😀'.repeat(60), '😀'.repeat(50)],
    ['日本語'.repeat(50), '日本語'.repeat(50).slice(0, 100)],
    ['.leading', 'leading'], ['trailing.', 'trailing'], [' .名前. ', '名前'],
    ['...', 'Harvest'], ['   ', 'Harvest'], ['', 'Harvest'],
    ['A/B:C*D?E"F<G>H|I', 'A_B_C_D_E_F_G_H_I'],
    ['制御\u0000\n\u007f文字', '制御___文字'],
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
