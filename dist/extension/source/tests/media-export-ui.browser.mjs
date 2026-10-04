import {serveExtension, extensionRoot} from "./support/extension-files.mjs";
import {launchBrowser} from "./support/browser.mjs";
import {mp4Bytes, brokenMedia} from './media-fixtures.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const mp4 = mp4Bytes;
let webm;
let repairBroken = false;

test('動画と単体画像を直接保存し、複数画像はZIPへ保存する', async (t) => {
  const {server} = await serveExtension(t, {headers: {
    "content-security-policy": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  }});

  const browser = await launchBrowser(t);
  const context = await browser.newContext({locale: 'ja-JP', reducedMotion: 'reduce', acceptDownloads: true});
  await context.addInitScript(() => {
    // This Web fixture mocks only the downloads API; real-extension coverage is separate.
    const listeners = new Set(), downloads = new Map();
    let nextDownload = 1;
    window.completeFixtureDownload = filename => {
      for (const [id, item] of downloads) {
        if (item.filename !== filename || item.state !== 'in_progress') continue;
        downloads.set(id, {...item, state: 'complete'});
        for (const listener of listeners) listener({id, state: {current: 'complete'}});
        break;
      }
    };
    window.chrome = {
      downloads: {
        async download({url, filename}) {
          const id = nextDownload++;
          downloads.set(id, {id, filename, state: 'in_progress'});
          const link = document.createElement('a');
          link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
          return id;
        },
        async search({id}) { return downloads.has(id) ? [downloads.get(id)] : []; },
        async cancel(id) { for (const listener of listeners) listener({id, state: {current: 'interrupted'}}); },
        onChanged: {addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener)},
      },
      runtime: {onConnect: {addListener() {} }},
      i18n: {getUILanguage: () => 'ja'},
      tabs: {
        query: async () => [{id: 7, url: 'https://source.example.test/gallery'}],
        get: async () => ({id: 7, url: 'https://source.example.test/gallery'}),
        onRemoved: {addListener() {}, removeListener() {} }
      },
      scripting: {executeScript: async () => [{result: window.fixture}]},
    };
  });
  await context.route('https://files.example.test/**', route => {
    const url = route.request().url();
    const isGif = url.endsWith('.gif') || url.includes('/gif-query?');
    const broken = Object.entries(brokenMedia).find(([name]) => url.includes(`/broken-${name}.`))?.[1];
    const body = broken && !repairBroken ? broken.bytes : isGif ? gif : url.endsWith('.mp4') ? mp4 : url.endsWith('.webm') ? webm : png;
    const contentType = isGif ? 'image/gif' : url.endsWith('.mp4') ? 'video/mp4' : url.endsWith('.webm') ? 'video/webm' : 'image/png';
    return route.fulfill({status: 200, contentType, body, headers: {'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-length', 'content-length': String(body.length)}});
  });
  const page = await context.newPage();
  // Match Chrome's completion contract before the app releases its Blob URL.
  page.on('download', async download => {
    await download.path();
    await page.evaluate(filename => window.completeFixtureDownload(filename), download.suggestedFilename());
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width: 768, height: 600});
  await page.goto(`http://127.0.0.1:${server.address().port}/app/index.html`);
  await page.locator("#export-format-pdf").check();
  webm = Buffer.from(await page.evaluate(async () => {
    const {Output, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource} = await import('./vendor/mediabunny/index.js');
    const target = new BufferTarget();
    const output = new Output({format: new WebMOutputFormat(), target});
    const canvas = new OffscreenCanvas(320, 240);
    canvas.getContext('2d').fillStyle = 'red';
    canvas.getContext('2d').fillRect(0, 0, 320, 240);
    const video = new CanvasSource(canvas, {codec: 'vp8', bitrate: 1_000_000});
    const audio = new AudioBufferSource({codec: 'opus', bitrate: 128_000});
    output.addVideoTrack(video);
    output.addAudioTrack(audio);
    await output.start();
    const buffer = new AudioBuffer({length: 48000, numberOfChannels: 1, sampleRate: 48000});
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.2 * Math.sin(i * 2 * Math.PI * 440 / 48000);
    await Promise.all([
      (async () => {
        for (let i = 0; i < 10; i++) await video.add(i / 10, 0.1);
        video.close();
      })(),
      audio.add(buffer).then(() => audio.close()),
    ]);
    await output.finalize();
    return Array.from(new Uint8Array(target.buffer));
  }));
  png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 960;
    canvas.getContext('2d').fillRect(0, 0, 640, 960);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const scan = async (images, media = []) => {
    await page.evaluate(({images, media}) => { window.fixture = {url: 'https://source.example.test/gallery', title: 'media', images, media}; }, {images, media});
    await page.locator('#scan').click();
    await page.waitForFunction(() => (document.querySelector('#scan').dataset.scanning === "false" && !document.querySelector('#scan').disabled));
  };
  const photo = 'https://files.example.test/photo.png';
  const animation = 'https://files.example.test/animation.gif';
  const movie = 'https://files.example.test/movie.mp4';
  await scan([photo]);
  assert.equal(await page.locator('#source-drop').textContent(), 'media.pdf');
  await page.locator('#source-drop').click();
  assert.equal(await page.locator('#source-url').inputValue(), 'https://source.example.test/gallery');
  await page.locator('#source-url').fill('https://source.example.test/next');
  await page.locator('#export-format-png').check();
  assert.equal(await page.locator('#source-drop').textContent(), 'media.png');
  await page.locator('#source-drop').click();
  assert.equal(await page.locator('#source-url').inputValue(), 'https://source.example.test/next');
  await page.locator('#source-url').fill('');
  await page.locator('#export-format-pdf').check();
  assert.equal(await page.locator('#source-drop').textContent(), 'media.pdf');
  await page.waitForFunction(() => document.querySelector('#images .item-resolution')?.textContent === '640 × 960');
  assert.equal(await page.locator('#images .item-resolution').isVisible(), true);
  const captionPosition = await page.locator('#images > li').first().evaluate(row => {
    const resolution = row.querySelector('.item-resolution').getBoundingClientRect();
    const name = document.createRange();
    name.selectNodeContents(row.querySelector('.item-title'));
    return resolution.bottom < name.getBoundingClientRect().top;
  });
  assert.equal(captionPosition, true, '解像度はファイル名の文字の上へ重ねる');
  assert.equal(await page.locator('#export-format-pdf').isChecked(), true);
  assert.equal(await page.locator('#export-format-jxl').isVisible(), true);
  assert.equal(await page.locator('#video-export-format-mp4').isVisible(), false);
  assert.equal(await page.locator('#export-format-gif').count(), 0);
  assert.equal(await page.locator('#export-format-original').isVisible(), true);
  assert.equal(await page.locator('#export-format-recommend').isVisible(), true);
  await scan([photo, animation], [{url: animation, kind: 'gif'}, {url: movie, kind: 'video'}]);
  assert.equal(await page.locator('#video-export-format-recommend').isChecked(), true);
  assert.equal(await page.locator('#export-format-pdf').isChecked(), true);
  const groups = page.locator('#groups .group-label');
  assert.deepEqual(await groups.allTextContents(), ['MP4\n(1件)', 'GIF\n(1件)', 'その他\nPNG\n(1枚)']);
  const gifGroup = page.locator('#groups .group-chip').filter({hasText: 'GIF'});
  await gifGroup.locator('input').check();
  assert.equal(await gifGroup.locator('input').isChecked(), true);
  await gifGroup.locator('button').click();
  assert.equal(await page.locator('#images > li').count(), 2, 'GIFだけの表示切替を動画とは独立に行う');
  await page.locator('#all-selection').check();
  await page.locator('#export-format-pdf').check();
  assert.doesNotMatch(await page.locator('#export-media-hint').textContent(), /対象外/);
  assert.match(await page.locator('#export').textContent(), /3件/);
  assert.equal(await page.locator('#export').isDisabled(), false);
  await page.locator('#video-export-format-mp4').check();
  const save = async (format, count = 1, outputFormat = format) => {
    const videosOnly=await page.locator('#image-export-formats').isHidden();
    await page.locator(format === 'mp4' || (videosOnly&&format === 'recommend') ? `#video-export-format-${format === 'mp4' ? 'mp4' : 'recommend'}` : `#export-format-${format === 'gif' ? 'recommend' : format}`).check();
    const individual = outputFormat === 'mp4' || count === 1;
    const received = [];
    let collect, timer;
    const downloadPromise = new Promise(resolve => {
      collect = download => {
        received.push(download);
        if (received.length === (individual ? count : 1)) { page.off('download', collect); resolve(received); }
      };
      page.on('download', collect);
    });
    let completed;
    try {
      completed = await Promise.race([
        Promise.all([downloadPromise, page.locator('#export').click()]).then(([downloads]) => downloads),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`missing downloads: ${format}`)), 10000); }),
      ]);
    } catch (error) {
      throw new Error(`${error.message} (${received.map(download => download.suggestedFilename()).join(', ')}): ${await page.locator('#export').textContent()} ${await page.locator('#status').textContent()} ${await page.locator('#failures').textContent()}`);
    } finally {
      clearTimeout(timer);
      page.off('download', collect);
    }
    if (individual) {
      const entries = await Promise.all(completed.map(async (download, index) => {
        const name = `${String(index + 1).padStart(3, '0')}.${outputFormat}`;
        assert.equal(download.suggestedFilename(), count === 1 ? `media.${outputFormat}` : `media_${name}`);
        return {name, data: await readFile(await download.path())};
      }));
      await page.waitForFunction(() => document.querySelector('#export').dataset.saving === 'false');
      return entries;
    }
    const download = completed[0];
    assert.equal(download.suggestedFilename(), 'media.zip');
    const bytes = await readFile(await download.path());
    const entries = [];
    let offset = 0;
    while (bytes.readUInt32LE(offset) === 0x04034b50) {
      const size = bytes.readUInt32LE(offset + 22), nameLength = bytes.readUInt16LE(offset + 26);
      const start = offset + 30 + nameLength;
      entries.push({name: bytes.subarray(offset + 30, start).toString(), data: bytes.subarray(start, start + size)});
      offset = start + size;
    }
    await page.waitForFunction(() => document.querySelector('#export').dataset.saving === 'false');
    return entries;
  };
  await page.evaluate(() => {
    window.mp4ValidationReads = 0;
    window.originalBlobRead = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function() {
      if (this.type === 'video/mp4') window.mp4ValidationReads++;
      return window.originalBlobRead.call(this);
    };
  });
  await scan([], [{url: movie,kind:'video'}]);
  const videos = await save('mp4');
  assert.equal(await page.evaluate(() => window.mp4ValidationReads), 1, 'MP4保存では同じBlobの完全性検査を1回だけ行う');
  await page.evaluate(() => { Blob.prototype.arrayBuffer = window.originalBlobRead; });
  assert.deepEqual(videos.map(e => e.name), ['001.mp4']);
  assert.deepEqual(videos[0].data, mp4);
  // The same merge used by scanTab must produce one download per video.
  const preferredMovie = 'https://files.example.test/high/movie.mp4';
  const separateMovie = 'https://files.example.test/other/movie.mp4';
  const merged = await page.evaluate(async ({movie, preferredMovie, separateMovie}) => {
    const {mergeMediaCandidates} = await import('../core/media-selection.js');
    return mergeMediaCandidates([{url: movie, kind: 'video'}, {url: separateMovie, kind: 'video'}],
      [{url: preferredMovie, kind: 'video', variantUrls: [movie]}]);
  }, {movie, preferredMovie, separateMovie});
  await scan([], merged);
  assert.deepEqual(await groups.allTextContents(), ['MP4\n(2件)']);
  const uniqueVideos = await save('mp4', 2);
  assert.deepEqual(uniqueVideos.map(entry => entry.name), ['001.mp4', '002.mp4']);
  await scan([photo, animation], [{url: animation, kind: 'gif'}, {url: movie, kind: 'video'}]);
  await page.locator('#all-selection').check();
  await scan([animation],[{url:animation,kind:'gif'}]);
  const gifs = await save('gif');
  assert.deepEqual(gifs.map(e => e.name), ['001.gif']);
  assert.deepEqual(gifs[0].data, gif);
  let downloads = 0;
  page.on('download', () => downloads++);
  for (const [name, {type}] of Object.entries(brokenMedia)) {
    repairBroken = false;
    const format = type === 'image/gif' ? 'gif' : 'mp4';
    const good = format === 'gif' ? animation : movie;
    const bad = `https://files.example.test/broken-${name}.${format}`;
    await scan(format === 'gif' ? [good, bad] : [], [{url: good, kind: format === 'gif' ? 'gif' : 'video'}, {url: bad, kind: format === 'gif' ? 'gif' : 'video'}]);
    await page.locator(format === 'mp4' ? '#video-export-format-mp4' : '#export-format-recommend').check();
    const before = downloads;
    await page.locator('#export').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error');
    assert.equal(downloads, before, name + ' must not save a partial ZIP');
    assert.match(await page.locator('#status').textContent(), /再試行/);
    assert.match(await page.locator('#failures').textContent(), /不完全|破損/);
    repairBroken = true;
    const retried = await save(format, 2);
    assert.deepEqual(retried.map(entry => entry.data), [format === 'gif' ? gif : mp4, format === 'gif' ? gif : mp4]);
    assert.equal(downloads, before + (format === 'mp4' ? 2 : 1));
  }
  await scan([photo, animation], [{url: animation, kind: 'gif'}, {url: movie, kind: 'video'}]);
  await page.locator('#all-selection').check();
  await scan([photo],[]);
  const images = await save('png');
  assert.deepEqual(images.map(e => e.name), ['001.png']);
  assert.deepEqual(images[0].data, png);
  await scan([], [{url: movie, kind: 'video'}]);
  assert.equal(await page.locator('#video-export-format-mp4').isChecked(), true);
  for (const format of ['pdf', 'jpg', 'png', 'jxl'])
    assert.equal(await page.locator(`#export-format-${format}`).isVisible(), false);
  assert.equal(await page.locator('#export').isDisabled(), false);
  assert.equal(await page.locator('#export-format-gif').count(), 0);
  await page.waitForFunction(() => / B$| KB$| MB$/.test(document.querySelector('#images .item-resolution')?.textContent ?? ''));
  assert.equal(await page.locator('#images .item-resolution').isVisible(), true, '動画には代替画像の解像度ではなく元ファイルのサイズを表示する');
  assert.match(await page.locator('#export').textContent(), /1件/);
  const webmUrl = 'https://files.example.test/movie.webm';
  const failures = await page.evaluate(async bytes => {
    const {prepareMp4} = await import('./media/mp4-conversion.js');
    const attempt = async (blob, limit) => {
      try {
        await prepareMp4(blob, undefined, limit);
        return 'unexpected success';
      }
      catch (error) {
        return error.message;
      }
    };
    const original = new Uint8Array(bytes);
    const unsupported = original.slice();
    const marker = new TextEncoder().encode('A_OPUS');
    const offset = unsupported.findIndex((_, i) => marker.every((v, j) => unsupported[i + j] === v));
    if (offset < 0) throw new Error('audio codec marker missing');
    unsupported.set(new TextEncoder().encode('A_NOPE'), offset);
    return {
      limit: await attempt(new Blob([original], {type: 'video/webm'}), 1),
      corrupt: await attempt(new Blob([original.slice(0, 8)], {type: 'video/webm'})),
      audio: await attempt(new Blob([unsupported], {type: 'video/webm'})),
    };
  }, Array.from(webm));
  assert.match(failures.limit, /上限/);
  assert.match(failures.corrupt, /MP4へ変換できません/);
  assert.match(failures.audio, /映像または音声をMP4へ変換できません/);
  const inspectMp4 = bytes => page.evaluate(async values => {
    const {Input, BlobSource, MP4, VideoSampleSink, AudioSampleSink} = await import('./vendor/mediabunny/index.js');
    const input = new Input({formats: [MP4], source: new BlobSource(new Blob([new Uint8Array(values)]))});
    try {
      const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
      const frame = await new VideoSampleSink(video).getSample(0);
      const sound = await new AudioSampleSink(audio).getSample(0);
      try {
        const canvas = new OffscreenCanvas(320, 240), ctx = canvas.getContext('2d');
        frame.draw(ctx, 0, 0);
        return {
          video: await video.getCodec(),
          audio: await audio.getCodec(),
          width: await video.getDisplayWidth(),
          height: await video.getDisplayHeight(),
          duration: await input.computeDuration(),
          red: ctx.getImageData(0, 0, 1, 1).data[0],
          audioFrames: sound.numberOfFrames
        };
      } finally {
        frame?.close();
        sound?.close();
      }
    } finally {
      input.dispose();
    }
  }, Array.from(bytes));
  for (const urls of [[webmUrl], [movie, webmUrl]]) {
    await scan([], urls.map(url => ({url, kind: 'video'})));
    await page.locator('#all-selection').check();
    assert.equal(await page.locator('#video-export-format-mp4').isChecked(), true);
    assert.match(await page.locator('#export-media-hint').textContent(), /WebMは変換/);
    const entries = await save('mp4', urls.length);
    assert.deepEqual(entries.map(entry => entry.name), urls.map((_, i) => `${String(i + 1).padStart(3, '0')}.mp4`));
    if (urls.includes(movie)) assert.deepEqual(entries[0].data, mp4);
    const info = await inspectMp4(entries.at(-1).data);
    assert.equal(info.video, 'avc');
    assert.equal(info.audio, 'aac');
    assert.equal(info.width, 320);
    assert.equal(info.height, 240);
    assert.ok(info.duration >= 0.95 && info.duration < 1.1, JSON.stringify(info));
    assert.ok(info.red > 200);
    assert.ok(info.audioFrames > 0);
  }
  await scan([], [{url: webmUrl, kind: 'video'}]);
  await page.locator('#video-export-format-recommend').check();
  assert.equal(await page.locator('#video-original-extension').textContent(), '(WEBM)');
  const recommendedVideo = await save('recommend', 1, 'mp4');
  const recommendedInfo = await inspectMp4(recommendedVideo[0].data);
  assert.equal(recommendedInfo.video, 'avc');
  assert.equal(recommendedInfo.audio, 'aac');
  await page.locator('#video-export-format-mp4').check();
  await scan([animation], [{url: animation, kind: 'gif'}]);
  assert.equal(await page.locator('#export-format-png').isChecked(), true);
  assert.equal(await page.locator('#video-export-format-mp4').isVisible(), false);
  assert.match(await page.locator('#export').textContent(), /1件/);
  assert.match(await page.locator('#export-media-hint').textContent(), /動く画像はGIF/);
  const gifUrls = [
    animation,
    ...['format=gif', 'fmt=gif', 'fm=gif', 'FORMAT=GIF', 'Fmt=GiF', 'FM=GIF']
      .map(query => `https://files.example.test/gif-query?${query}`)
  ];
  const sourcePage = await context.newPage();
  const scanSource = await readFile(resolve(extensionRoot, 'app/content/page-scan.js'), 'utf8');
  const gifScan = await sourcePage.evaluate(async ({urls, source}) => {
    for (const url of urls) {
      const image = document.createElement('img');
      image.src = url;
      document.body.append(image);
    }
    const moduleUrl = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    try {
      const {scanDocument} = await import(moduleUrl);
      return await scanDocument();
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  }, {urls: gifUrls, source: scanSource});
  await sourcePage.close();
  await page.locator("#export-format-recommend").check();
  for (const url of gifUrls) {
    assert.ok(gifScan.images.includes(url), url);
    const media = gifScan.media.filter(item => item.url === url);
    assert.deepEqual(media, [{url, kind: 'gif'}]);
    await scan([url], media);
    assert.equal(await page.locator('#export-format-recommend').isChecked(), true, url);
    assert.equal(await page.locator('#export').isDisabled(), false, url);
    const entries = await save('gif');
    assert.deepEqual(entries.map(entry => entry.name), ['001.gif']);
    assert.deepEqual(entries[0].data, gif);
  }
  await scan([photo, animation], [{url: animation, kind: 'gif'}, {url: movie, kind: 'video'}]);
  await page.locator('#all-selection').check();
  await page.locator('#all-visibility').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#images > li img')].slice(0, 2).every(image => image.complete && image.naturalWidth > 0));
  const {formatFileSize} = await import('../dist/extension/core/file-size.js');
  await page.waitForFunction(expected => [...document.querySelectorAll('#images .item-resolution')].at(-1)?.textContent === expected, formatFileSize(mp4.length));
  assert.deepEqual(await page.locator('#images .item-resolution').allTextContents(), ['640 × 960', '1 × 1', formatFileSize(mp4.length)]);
  await page.screenshot({path: '/private/tmp/harvest-media-ui.png'});
  assert.deepEqual(errors, []);
});
