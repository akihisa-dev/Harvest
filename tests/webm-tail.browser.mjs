import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {temporaryDirectory, launchExtensionContext} from './support/browser.mjs';

test('実拡張機能でWebMの末尾・VFR・音声をMP4とrecommend保存でも保持する', {timeout: 120_000}, async t => {
  const temporary = await temporaryDirectory(t, '/tmp/harvest-webm-tail-');
  const profile = `${temporary}/profile`, downloads = `${temporary}/downloads`;
  await mkdir(`${profile}/Default`, {recursive: true}); await mkdir(downloads);
  await writeFile(`${profile}/Default/Preferences`, JSON.stringify({download: {default_directory: downloads, prompt_for_download: false}}));
  const context = await launchExtensionContext(t, profile, {locale: 'ja-JP', reducedMotion: 'reduce', args: [
    '--enable-unsafe-extension-debugging', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--no-first-run']});
  const cdp = await context.browser().newBrowserCDPSession();
  const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('dist/extension')});
  await cdp.send('Browser.setDownloadBehavior', {behavior: 'default'});
  let webm;
  await context.route('https://fixture.example.test/**', route => route.fulfill({contentType: 'video/webm',
    body: route.request().method() === 'HEAD' ? '' : webm, headers: {'content-length': String(webm.length)}}));
  await context.route(/https?:\/\/(?!fixture\.example\.test\/)/, route => route.abort('blockedbyclient'));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/app/index.html`);
  // Compare audio with the unadapted pinned Conversion, including its existing AAC padding.
  const upstream = await readFile('node_modules/mediabunny/dist/bundles/mediabunny.min.mjs');
  const extensionRoot = resolve('dist/extension');
  await context.route('https://baseline.example.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({contentType: 'text/html', body: '<title>conversion baseline</title>'});
    if (path === '/app/vendor/mediabunny/index.js') return route.fulfill({contentType: 'text/javascript', body: upstream});
    const file = resolve(extensionRoot, '.' + path);
    assert.ok(file.startsWith(extensionRoot + '/'));
    return route.fulfill({contentType: 'text/javascript', body: await readFile(file)});
  });
  const baselinePage = await context.newPage();
  await baselinePage.goto('https://baseline.example.test/');
  await page.evaluate(() => {
    window.fixture = {}; window.ownDownloads = [];
    chrome.downloads.onCreated.addListener(item => window.ownDownloads.push(item.id));
    chrome.tabs.query = async () => [{id: 7, url: 'https://fixture.example.test/gallery'}];
    chrome.tabs.get = async () => ({id: 7, url: 'https://fixture.example.test/gallery'});
    chrome.scripting.executeScript = async () => [{result: window.fixture}];
  });
  const inspect = async (bytes, type) => page.evaluate(async ({bytes, type}) => {
    const {Input, BlobSource, ALL_FORMATS, VideoSampleSink, AudioSampleSink, EncodedPacketSink} = await import('./vendor/mediabunny/index.js');
    const blob = new Blob([new Uint8Array(bytes)], {type});
    const input = new Input({formats: ALL_FORMATS, source: new BlobSource(blob)});
    const video = await input.getPrimaryVideoTrack(), frames = [];
    for await (const sample of new VideoSampleSink(video).samples()) {
      const canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight), context = canvas.getContext('2d');
      sample.draw(context, 0, 0);
      frames.push({timestamp: sample.timestamp, duration: sample.duration, width: sample.displayWidth,
        height: sample.displayHeight, pixel: [...context.getImageData(10, 10, 1, 1).data]});
      sample.close();
    }
    const audio = await input.getPrimaryAudioTrack(); let sound = null;
    if (audio) {
      let first = Infinity, end = 0, power = 0, count = 0;
      for await (const sample of new AudioSampleSink(audio).samples()) {
        first = Math.min(first, sample.timestamp); end = Math.max(end, sample.timestamp + sample.duration);
        const values = sample.toAudioBuffer().getChannelData(0);
        for (const value of values) power += value * value;
        count += values.length; sample.close();
      }
      const packets = [];
      for await (const packet of new EncodedPacketSink(audio).packets()) packets.push(packet.data);
      const encoded = new Uint8Array(packets.reduce((size, packet) => size + packet.length, 0));
      let offset = 0;
      for (const packet of packets) { encoded.set(packet, offset); offset += packet.length; }
      const encodedHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      sound = {first, end, rms: Math.sqrt(power / count), codec: await audio.getCodec(), encodedHash};
    }
    input.dispose();
    const element = document.createElement('video'); element.muted = true;
    element.src = URL.createObjectURL(blob); document.body.append(element);
    try {
      await new Promise((resolve, reject) => {
        element.addEventListener('loadedmetadata', resolve, {once: true});
        element.addEventListener('error', () => reject(new Error('video metadata failed')), {once: true});
      });
      const duration = element.duration;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('video playback timeout')), 5000);
        element.addEventListener('ended', () => { clearTimeout(timer); resolve(); }, {once: true});
        element.play().catch(reject);
      });
      const canvas = new OffscreenCanvas(element.videoWidth, element.videoHeight), context = canvas.getContext('2d');
      context.drawImage(element, 0, 0);
      return {frames, sound, playback: {duration, ended: element.ended, pixel: [...context.getImageData(10, 10, 1, 1).data]}};
    } finally { URL.revokeObjectURL(element.src); element.remove(); }
  }, {bytes: [...bytes], type});
  const save = async (format, title) => {
    await page.locator(`#export-format-${format}`).check();
    const count = await page.evaluate(() => window.ownDownloads.length);
    await page.locator('#export').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'success');
    await page.waitForFunction(count => window.ownDownloads.length === count + 1, count);
    await page.waitForFunction(async () => (await chrome.downloads.search({id: window.ownDownloads.at(-1)}))[0]?.state === 'complete');
    const item = await page.evaluate(async () => (await chrome.downloads.search({id: window.ownDownloads.at(-1)}))[0]);
    assert.match(item.filename, new RegExp(`${title}.*\\.${format === 'original' ? 'webm' : 'mp4'}$`));
    return readFile(item.filename);
  };
  for (const variant of ['missing', 'default', 'vfr', 'vfr-audio']) {
    const timestamps = variant.startsWith('vfr') ? [0, .04, .17, .25, .4, .5] : [0, .1, .2, .3, .4, .5];
    webm = Buffer.from(await page.evaluate(async ({variant, timestamps}) => {
      const {Output, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource} = await import('./vendor/mediabunny/index.js');
      const canvas = new OffscreenCanvas(32, 24), context = canvas.getContext('2d'), target = new BufferTarget();
      const output = new Output({format: new WebMOutputFormat(), target});
      const video = new CanvasSource(canvas, {codec: 'vp8', bitrate: 100_000});
      output.addVideoTrack(video, variant === 'default' ? {frameRate: 10} : {});
      const audio = variant.endsWith('audio') ? new AudioBufferSource({codec: 'opus', bitrate: 64_000}) : null;
      if (audio) output.addAudioTrack(audio);
      await output.start();
      await Promise.all([
        (async () => {
          for (let i = 0; i < timestamps.length; i++) {
            context.fillStyle = i === 5 ? 'white' : ['red', 'lime', 'blue'][Math.floor(i / 2)];
            context.fillRect(0, 0, 32, 24);
            await video.add(timestamps[i], (timestamps[i + 1] ?? .6) - timestamps[i]);
          }
          video.close();
        })(),
        (async () => {
          if (!audio) return;
          const buffer = new AudioBuffer({length: 38_400, numberOfChannels: 1, sampleRate: 48_000});
          const values = buffer.getChannelData(0);
          for (let i = 0; i < values.length; i++) values[i] = .2 * Math.sin(i * 2 * Math.PI * 440 / 48_000);
          await audio.add(buffer); audio.close();
        })(),
      ]);
      await output.finalize(); return [...new Uint8Array(target.buffer)];
    }, {variant, timestamps}));
    const original = await inspect(webm, 'video/webm');
    assert.equal(original.frames.length, 6);
    assert.equal(original.frames.at(-1).duration === 0, variant !== 'default', '欠ける末尾表示時間を含むfixture');
    let baseline = null;
    if (original.sound) {
      const bytes = await baselinePage.evaluate(async bytes => {
        const {convertWebmToMp4} = await import('/app/workers/mp4-codec.js');
        const blob = await convertWebmToMp4(new Blob([new Uint8Array(bytes)], {type: 'video/webm'}), 1_000_000);
        return [...new Uint8Array(await blob.arrayBuffer())];
      }, [...webm]);
      baseline = await inspect(Buffer.from(bytes), 'video/mp4');
      assert.equal(baseline.frames.length, 5, '未補正の固定版は末尾を落とす');
    }
    await page.evaluate(title => { window.fixture = {url: 'https://fixture.example.test/gallery', title, images: [],
      media: [{url: 'https://fixture.example.test/movie.webm', kind: 'video'}]}; }, variant);
    await page.locator('#scan').click();
    await page.waitForFunction(() => document.querySelector('#scan').dataset.scanning === 'false' && !document.querySelector('#scan').disabled);
    assert.deepEqual(await save('original', variant), webm);
    for (const format of ['mp4', 'recommend']) {
      const converted = await inspect(await save(format, variant), 'video/mp4');
      assert.equal(converted.frames.length, 6, `${variant}/${format}: 末尾を含む全フレーム`);
      converted.frames.forEach((frame, index) => {
        assert.ok(Math.abs(frame.timestamp - timestamps[index]) < .002, 'VFRの表示時刻を固定FPSへ丸めない');
        assert.equal(frame.width, 32); assert.equal(frame.height, 24); assert.ok(frame.duration > 0);
        assert.ok(frame.pixel.slice(0, 3).every((channel, color) => Math.abs(channel - original.frames[index].pixel[color]) < 15));
      });
      assert.equal(converted.playback.ended, true);
      assert.ok(converted.playback.pixel.slice(0, 3).every(channel => channel > 230), 'Chromeでも末尾の白を再生する');
      if (original.sound) {
        assert.equal(converted.sound.codec, 'aac');
        assert.ok(Math.abs(converted.sound.end - baseline.sound.end) < .002, '既存の音声終端を変更しない');
        assert.ok(Math.abs(converted.sound.first - baseline.sound.first) < .002);
        assert.ok(Math.abs(converted.sound.rms - baseline.sound.rms) < .0002, '音声サンプルを変更しない');
        assert.equal(converted.sound.encodedHash, baseline.sound.encodedHash, '既存変換とAACパケットのバイト列も一致する');
        assert.ok(Math.abs(converted.playback.duration - baseline.playback.duration) < .002);
      } else {
        assert.equal(converted.sound, null);
        assert.ok(Math.abs(converted.playback.duration - original.playback.duration) < .002);
      }
      console.log(`${variant}/${format}: ${converted.frames.length} frames, ${converted.playback.duration}s, audio=${JSON.stringify(converted.sound)}`);
    }
  }
  const limits = await page.evaluate(async bytes => {
    const {prepareMp4} = await import('./media/mp4-conversion.js');
    try { await prepareMp4(new Blob([new Uint8Array(bytes)], {type: 'video/webm'}), undefined, 64); return 'unexpected success'; }
    catch (error) { return error.message; }
  }, [...webm]);
  assert.match(limits, /容量の上限/); assert.deepEqual(errors, []);
});
