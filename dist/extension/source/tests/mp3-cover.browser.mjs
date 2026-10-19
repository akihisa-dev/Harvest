import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel, readCompletedDownload} from './support/animation-panel.mjs';
import {mediaFixturePage} from './support/media-fixture-page.mjs';
import {redPng} from './animation-fixtures.mjs';
import {readCover} from './support/mp3-cover.mjs';

test('MP3個別保存と混在ZIPに動画のカバーを埋め込み、取得失敗時も再生可能な音声を保存する', {timeout: 90000}, async t => {
  const assets = new Map([['/cover.png', [redPng, 'image/png']], ['/broken.png', [Buffer.from('broken'), 'image/png']]]);
  const {page, scan} = await animationPanel(t, assets);
  const fixture = await mediaFixturePage(t, page);
  const movie = await fixture.evaluate(async () => {
    const {Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource} = await import('/mediabunny.js');
    const target = new BufferTarget(), canvas = new OffscreenCanvas(32, 24);
    canvas.getContext('2d').fillRect(0, 0, 32, 24);
    const output = new Output({format: new Mp4OutputFormat(), target});
    const video = new CanvasSource(canvas, {codec: 'avc', bitrate: 100000});
    const audio = new AudioBufferSource({codec: 'aac', bitrate: 64000});
    output.addVideoTrack(video, {frameRate: 10}); output.addAudioTrack(audio);
    await output.start();
    const samples = new AudioBuffer({length: 9600, numberOfChannels: 1, sampleRate: 48000});
    samples.getChannelData(0).forEach((_, i, values) => {values[i] = .2 * Math.sin(i * 2 * Math.PI * 440 / 48000);});
    await Promise.all([video.add(0, .2), audio.add(samples)]);
    video.close(); audio.close(); await output.finalize();
    return [...new Uint8Array(target.buffer)];
  });
  assets.set('/movie.mp4', [Buffer.from(movie), 'video/mp4']);
  await scan(['/movie.mp4'], 'cover-test');
  const exportItems = async (preview, mixed = false) => {
    return page.evaluate(async ({preview, mixed}) => {
      const {createMixedExportController} = await import('./panel/mixed-export-controller.js');
      const sourcePage = document.querySelector('#source-url').value;
      const base = new URL(sourcePage).origin;
      const video = {url: `${base}/movie.mp4`, sourcePage, selected: true, kind: 'video', ...(preview ? {previewUrl: `${base}/${preview}`} : {})};
      const selected = [video, ...(mixed ? [{url: `${base}/cover.png`, sourcePage, selected: true, kind: 'image'}] : [])];
      let status, completed = false;
      const controller = createMixedExportController({
        getSelectedItems: () => selected, getZipFilename: () => '涼宮ハルヒ 🎵.zip', getPdfFilename: () => 'covered.pdf',
        isBusy: () => false, isDisposed: () => false, onBusyChange() {}, onCloseViewer() {}, onClearSourceUrl() {}, onScrollToFailures() {},
        onStatus(message, state) {status = {message, state};}, onCompleted() {completed = true;},
      });
      const before = window.downloadIds.length;
      await controller.export({imageFormat: 'png', videoFormat: 'mp3', includeSourcePage: false});
      return {status, completed, id: window.downloadIds.length > before ? window.downloadIds.at(-1) : null};
    }, {preview, mixed});
  };
  const download = async (preview, mixed = false) => {
    const result = await exportItems(preview, mixed);
    assert.equal(result.status.state, 'success', JSON.stringify(result));
    assert.equal(result.completed, true);
    const item = await page.evaluate(async id => (await chrome.downloads.search({id}))[0], result.id);
    assert.ok(item.filename.endsWith(mixed ? '.zip' : '.mp3'));
    return readCompletedDownload(item.filename);
  };
  const audio = await download('cover.png');
  const cover = readCover(audio);
  assert.equal(cover.mime, 'image/jpeg');
  assert.equal(cover.title, '涼宮ハルヒ 🎵');
  const playback = await fixture.evaluate(async audio => {
    const {Input, BlobSource, ALL_FORMATS} = await import('/mediabunny.js');
    const input = new Input({formats: ALL_FORMATS, source: new BlobSource(new Blob([new Uint8Array(audio)]))});
    let metadata;
    try {metadata = await input.getMetadataTags();} finally {input.dispose();}
    const image = metadata.images[0];
    const bitmap = await createImageBitmap(new Blob([image.data], {type: image.mimeType}));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), pixels = canvas.getContext('2d');
    pixels.drawImage(bitmap, 0, 0); bitmap.close();
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(new Uint8Array(audio).buffer);
      return {title: metadata.title, kind: image.kind, pixel: [...pixels.getImageData(0, 0, 1, 1).data], duration: decoded.duration};
    } finally {await context.close();}
  }, [...audio]);
  assert.equal(playback.title, '涼宮ハルヒ 🎵');
  assert.equal(playback.kind, 'coverFront');
  assert.ok(playback.pixel[0] > 240 && playback.pixel[1] < 15 && playback.pixel[2] < 15);
  assert.ok(playback.duration > .15 && playback.duration < .35);
  const zip = await download('cover.png', true);
  let at = 0, embedded;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 22), start = at + 30 + zip.readUInt16LE(at + 26);
    if (zip.subarray(at + 30, start).toString().endsWith('.mp3')) embedded = zip.subarray(start, start + size);
    at = start + size;
  }
  assert.deepEqual(readCover(embedded).image, cover.image);
  assert.equal(readCover(embedded).title, '涼宮ハルヒ 🎵_001');
  for (const preview of [null, 'missing.png', 'broken.png']) {
    const plain = await download(preview);
    assert.deepEqual(plain, audio.subarray(cover.audioOffset), '画像なし・取得失敗・壊れた画像でも音声を維持する');
  }
  const boundaries = await page.evaluate(async movie => {
    const {prepareAudioWithCover} = await import('./media/audio-cover.js');
    const {prepareAudio} = await import('./media/audio-conversion.js');
    const input = new Blob([new Uint8Array(movie)], {type: 'video/mp4'});
    const sourcePage = document.querySelector('#source-url').value;
    const item = {url: new URL('/movie.mp4', sourcePage).href, sourcePage, previewUrl: new URL('/cover.png', sourcePage).href};
    const plain = await prepareAudio(input);
    const limited = await prepareAudioWithCover(item, '境界テスト', input, undefined, plain.size);
    const controller = new AbortController();
    const nativeFetch = window.fetch;
    window.fetch = (...args) => {
      controller.abort();
      return nativeFetch(...args);
    };
    let cancelled;
    try {await prepareAudioWithCover(item, '境界テスト', input, controller.signal);} catch (error) {cancelled = error.kind ?? error.name;}
    finally {window.fetch = nativeFetch;}
    return {plain: [...new Uint8Array(await plain.arrayBuffer())], limited: [...new Uint8Array(await limited.arrayBuffer())], cancelled};
  }, movie);
  assert.deepEqual(boundaries.limited, boundaries.plain, '音声が上限内なら画像を省略して保存する');
  assert.equal(boundaries.cancelled, 'cancelled');
});
