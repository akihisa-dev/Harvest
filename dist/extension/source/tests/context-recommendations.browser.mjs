import assert from 'node:assert/strict';
import test from 'node:test';
import {basename} from 'node:path';
import {animationPanel} from './support/animation-panel.mjs';
import {baselineJpeg, progressiveJpeg} from './jpeg-fixtures.mjs';

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

async function recommendationState(page) {
  return page.locator('#image-export-formats label').evaluateAll(labels => labels.map(label => ({
    format: label.querySelector('input').value,
    recommended: label.dataset.recommended,
    reason: label.querySelector('input').getAttribute('aria-description'),
  })));
}

async function expectImageRecommendations(page, series, japanese) {
  const original = page.locator('label:has(#export-format-original)');
  const pdf = page.locator('label:has(#export-format-pdf)');
  assert.equal(await original.getAttribute('data-recommended'), 'true');
  assert.match(await original.evaluate(label => getComputedStyle(label, '::after').content), /★/);
  assert.match(await page.locator('#export-format-original').getAttribute('aria-description'),
    japanese ? /各ファイルをそのまま残す/ : /keep each file unchanged/);
  assert.equal(await pdf.getAttribute('data-recommended'), String(series));
  if (series) {
    assert.match(await pdf.evaluate(label => getComputedStyle(label, '::after').content), /★/);
    assert.match(await page.locator('#export-format-pdf').getAttribute('aria-description'),
      japanese ? /シリーズを一冊にまとめて読む/ : /read this series in one document/);
    assert.match(await page.locator('#export-media-hint').textContent(),
      japanese ? /各ファイルをそのまま残す.*シリーズを一冊にまとめて読む/ : /keep each file unchanged.*read this series in one document/);
  } else {
    assert.equal(await page.locator('#export-format-pdf').getAttribute('aria-description'), null);
  }
}

async function expectGroupOnlyScroll(page, label) {
  // Match the native input widget to the emulated viewport, as in ui-layout.
  // Chrome can dispatch a wheel inside the DOM but outside a stale widget.
  await page.bringToFront();
  const session = await page.context().newCDPSession(page);
  try {
    const {windowId} = await session.send('Browser.getWindowForTarget');
    const {width, height} = page.viewportSize();
    await session.send('Browser.setWindowBounds', {windowId, bounds: {width: width + 100, height: height + 100}});
  } finally {await session.detach();}
  const list = page.locator('.group-bar');
  const state = () => page.evaluate(() => {
    const list = document.querySelector('.group-bar');
    return {
      listTop: list.scrollTop,
      end: list.scrollHeight - list.clientHeight,
      sidebarTop: document.querySelector('.workspace-sidebar').scrollTop,
      pageTop: document.scrollingElement.scrollTop,
      fixed: ['.save-area', '#export-media-hint', '.results-heading', '.toolbar'].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      }),
    };
  });
  await list.evaluate(element => {element.scrollTop = 0;});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await state();
  assert.ok(before.end > 0, `${label}: グループ一覧がスクロール対象になる`);
  const box = await list.boundingBox();
  assert.ok(box.height >= 28, `${label}: 最低1つのグループ操作ボタンを表示できる`);
  const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
  assert.equal(await page.evaluate(({x, y}) => document.querySelector('.group-bar').contains(document.elementFromPoint(x, y)), point), true);
  await page.mouse.move(0, 0);
  await page.mouse.move(point.x, point.y);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await page.evaluate(() => {
    window.recommendationWheel = null;
    window.recommendationScrollEnded = false;
    document.querySelector('.group-bar').addEventListener('scrollend', () => {
      window.recommendationScrollEnded = true;
    }, {once: true});
    document.addEventListener('wheel', event => {
      window.recommendationWheel = {trusted: event.isTrusted, target: event.target.outerHTML.slice(0, 160)};
      queueMicrotask(() => {window.recommendationWheel.prevented = event.defaultPrevented;});
    }, {once: true, passive: true});
  });
  await page.screenshot();
  await page.mouse.wheel(0, 160);
  try {
    await page.waitForFunction(() => document.querySelector('.group-bar').scrollTop > 0, null, {timeout: 3000});
  } catch (error) {
    await page.screenshot({path: `/tmp/harvest-recommendations-wheel-${label.replaceAll(' ', '-')}.png`});
    console.error(`${label}: ${JSON.stringify({before, after: await state(), wheel: await page.evaluate(() => window.recommendationWheel)})}`);
    throw error;
  }
  await page.waitForFunction(() => window.recommendationScrollEnded, null, {timeout: 3000});
  const after = await state();
  assert.deepEqual(after.fixed, before.fixed, `${label}: 推奨説明、保存UI、グループ見出しを固定する`);
  assert.equal(after.sidebarTop, 0, `${label}: 右パネル全体はスクロールしない`);
  assert.equal(after.pageTop, before.pageTop, `${label}: ページ全体はスクロールしない`);
}

test('日英で選択したシリーズにPDFと原本の理由を示し、表示切替と独立して各形式で保存できる', {timeout: 90000}, async t => {
  for (const locale of ['ja-JP', 'en-US']) {
    const japanese = locale === 'ja-JP';
    const assets = new Map();
    const {page, scan, saved} = await animationPanel(t, assets, {locale});
    const jpeg = [Buffer.from(baselineJpeg), Buffer.from(progressiveJpeg)];
    const series = ['/series/page-01.jpg', '/series/page-02.jpg'];
    assets.set(series[0], [jpeg[0], 'image/jpeg']);
    assets.set(series[1], [jpeg[1], 'image/jpeg']);
    assets.set('/separate/photo.jpg', [jpeg[0], 'image/jpeg']);
    await scan([...series, '/separate/photo.jpg'], 'series');
    await page.locator('#all-selection').uncheck();
    const seriesSelection = page.locator('#groups input[data-focus-key*="/series/"]');
    await seriesSelection.check();
    const restoreSeries = async () => {
      // A completed save clears the source input. A fresh scan restores its label.
      await scan([...series, '/separate/photo.jpg'], 'series');
      await page.locator('#all-selection').uncheck();
      await seriesSelection.check();
    };
    assert.equal(await page.locator('#export-format-recommend').isChecked(), true);
    await expectImageRecommendations(page, true, japanese);
    assert.equal(await page.locator('#export-recommend-extension').textContent(), '(PDF)');
    assert.equal(await page.locator('#source-drop').textContent(), 'series.pdf');
    assert.equal(await page.locator('.source-page-option').isVisible(), true, '推奨がPDFなら出典設定を操作できる');
    await page.locator('#include-source-page').uncheck();
    const automaticPdf = await saved('recommend');
    assert.equal(basename(automaticPdf.filename), 'series.pdf');
    assert.ok(automaticPdf.bytes.toString('latin1').startsWith('%PDF-'));
    assert.match(automaticPdf.bytes.toString('latin1'), /\/Count 2\b/, '推奨保存は選んだシリーズだけを一冊にする');
    await restoreSeries();

    const beforeVisibility = await recommendationState(page);
    const beforeFilename = await page.locator('#source-drop').textContent();
    const seriesEye = page.locator('#groups button[data-focus-key*="/series/"]');
    await seriesEye.click();
    assert.equal(await page.locator('#images > li[data-focus-url]').count(), 0);
    assert.deepEqual(await recommendationState(page), beforeVisibility, '表示だけ隠しても推奨は変わらない');
    assert.equal(await page.locator('#source-drop').textContent(), beforeFilename);
    await seriesEye.click();
    const secondPage = page.locator('#images > li[data-focus-url$="/series/page-02.jpg"]');
    await secondPage.click();
    await expectImageRecommendations(page, false, japanese);
    assert.equal(await page.locator('#export-recommend-extension').textContent(), '(JPG)');
    assert.equal(await page.locator('#source-drop').textContent(), 'series.jpg');
    assert.equal(await page.locator('.source-page-option').isHidden(), true);
    const automaticImage = await saved('recommend');
    assert.equal(basename(automaticImage.filename), 'series.jpg');
    assert.deepEqual(automaticImage.bytes, jpeg[0], '1枚に絞ると推奨保存も元のJPEGになる');
    await restoreSeries();
    await expectImageRecommendations(page, true, japanese);
    const separateSelection = page.locator('#groups input[data-focus-key$="99_others"]');
    await separateSelection.check();
    await expectImageRecommendations(page, false, japanese);
    await separateSelection.uncheck();
    await expectImageRecommendations(page, true, japanese);
    assert.equal(await page.locator('.source-page-option').isVisible(), true);
    await page.locator('#include-source-page').check();
    const automaticWithSource = await saved('recommend');
    assert.match(basename(automaticWithSource.filename), /^series(?: \(\d+\))?\.pdf$/);
    assert.match(automaticWithSource.bytes.toString('latin1'), /\/Count 3\b/, '推奨PDFにも指定した出典ページを追加する');
    await restoreSeries();

    // Explicit output choices remain independent of the automatic default.
    await page.locator('#export-format-original').check();
    assert.equal(await page.locator('#source-drop').textContent(), 'series.zip');
    const archive = await saved('original');
    assert.equal(basename(archive.filename), 'series.zip');
    const entries = zipEntries(archive.bytes);
    assert.deepEqual(entries.map(entry => entry.name), ['001.jpg', '002.jpg']);
    assert.deepEqual(entries.map(entry => entry.bytes), jpeg, '推奨された原本保存はシリーズ順のJPEGをそのまま格納する');
    await restoreSeries();

    await page.locator('#export-format-pdf').check();
    await page.locator('#include-source-page').check();
    assert.equal(await page.locator('#source-drop').textContent(), 'series.pdf');
    const sourceUrl = await page.locator('#source-url').inputValue();
    const pdf = await saved('pdf');
    assert.match(basename(pdf.filename), /^series(?: \(\d+\))?\.pdf$/);
    const source = pdf.bytes.toString('latin1');
    assert.ok(source.startsWith('%PDF-'));
    assert.match(source, /\/Count 3\b/, '画像2ページと出典ページを保存する');
    const firstJpeg = pdf.bytes.indexOf(jpeg[0]), secondJpeg = pdf.bytes.indexOf(jpeg[1]);
    assert.ok(firstJpeg > 0 && secondJpeg > firstJpeg, 'PDFにも表示順でJPEGを埋め込む');
    const asciiText = [...source.matchAll(/\/F2 \S+ Tf 1 0 0 1 [^ ]+ [^ ]+ Tm <([0-9a-f]+)> Tj/g)]
      .map(match => Buffer.from(match[1], 'hex').toString('latin1')).join('');
    assert.ok(asciiText.includes('series.pdf'), '出典ページに保存名を含める');
    assert.ok(sourceUrl && asciiText.includes(sourceUrl), '出典ページに解析元URLを含める');

    // Keep the selected series while adding enough unrelated groups to scroll.
    const many = [...series];
    for (let group = 0; group < 20; group++) for (let index = 1; index <= 2; index++) {
      const path = `/set-${group}/page-${index}.jpg`;
      assets.set(path, [jpeg[(index - 1) % 2], 'image/jpeg']); many.push(path);
    }
    for (const [width, height] of [[1280, 800], [320, 300]]) {
      await page.setViewportSize({width, height});
      // Open at the target size so each native wheel gesture targets a fresh scroll layer.
      await page.reload();
      await scan(many, 'series-layout');
      await page.locator('#all-selection').uncheck();
      await seriesSelection.check();
      assert.equal(await page.locator('#export-format-recommend').isChecked(), true);
      await expectImageRecommendations(page, true, japanese);
      assert.equal(await page.locator('#export-media-hint').isVisible(), true);
      assert.equal(await page.locator('#export-media-hint').getAttribute('title'), await page.locator('#export-media-hint').textContent(), '狭い画面でも説明全文を参照できる');
      const clipped = await page.locator('#image-export-formats label').evaluateAll(labels => labels.filter(label => {
        const rect = label.getBoundingClientRect();
        return rect.width > 0 && (rect.left < 0 || rect.right > innerWidth || label.scrollWidth > label.clientWidth + 1);
      }).map(label => label.textContent));
      assert.deepEqual(clipped, [], `${locale} ${width}x${height}: 推奨の星を含む選択肢を見切れさせない`);
      await expectGroupOnlyScroll(page, `${locale} ${width}x${height}`);
      await page.screenshot({path: `/tmp/harvest-recommendations-${locale}-${width}x${height}.png`});
    }
  }
});
