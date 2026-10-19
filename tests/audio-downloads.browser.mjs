import {mediaFixturePage} from "./support/media-fixture-page.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel, readCompletedDownload} from './support/animation-panel.mjs';
import {redPng} from './animation-fixtures.mjs';

function entries(bytes) {
  const result = []; let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const size = bytes.readUInt32LE(at + 22), start = at + 30 + bytes.readUInt16LE(at + 26);
    result.push({name: bytes.subarray(at + 30, start).toString(), bytes: bytes.subarray(start, start + size)});
    at = start + size;
  }
  return result;
}

test('音声MP3を個別/混在保存し、MP3再生・WebM変換・無音拒否・再試行を実Chromeで確認する', {timeout: 90000}, async t => {
  const assets = new Map([['/red.png', [redPng, 'image/png']]]);
  const {page, scan, saved, failed, count, requests} = await animationPanel(t, assets);
  assert.match(page.url(), /^chrome-extension:/);
  assert.ok(await page.title());
  const fixturePage = await mediaFixturePage(t, page);
  const make = (webm, silent = false) => fixturePage.evaluate(async ({webm, silent}) => {
    const {Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource} = await import('/mediabunny.js');
    const canvas = new OffscreenCanvas(32, 24), target = new BufferTarget();
    canvas.getContext("2d").fillRect(0, 0, 32, 24);
    const output = new Output({format: webm ? new WebMOutputFormat() : new Mp4OutputFormat(), target});
    const video = new CanvasSource(canvas, {codec: webm ? 'vp8' : 'avc', bitrate: 100000});
    output.addVideoTrack(video, {frameRate: 10});
    const audio = silent ? null : new AudioBufferSource({codec: webm ? 'opus' : 'aac', bitrate: 64000});
    if (audio) output.addAudioTrack(audio);
    await output.start();
    await Promise.all([(async () => {for (let i = 0; i < 4; i++) await video.add(i / 10, .1); video.close();})(), (async () => {
      if (!audio) return;
      const buffer = new AudioBuffer({length: 19200, numberOfChannels: 1, sampleRate: 48000});
      const values = buffer.getChannelData(0);
      for (let i = 0; i < values.length; i++) values[i] = .2 * Math.sin(i * 2 * Math.PI * 440 / 48000);
      await audio.add(buffer); audio.close();
    })()]);
    await output.finalize(); return [...new Uint8Array(target.buffer)];
  }, {webm, silent});
  const inspect = bytes => fixturePage.evaluate(async bytes => {
    const {Input, BlobSource, ALL_FORMATS, EncodedPacketSink, AudioSampleSink} = await import('/mediabunny.js');
    const input = new Input({formats: ALL_FORMATS, source: new BlobSource(new Blob([new Uint8Array(bytes)]))});
    try {
      const audio = await input.getPrimaryAudioTrack(), packets = [];
      for await (const packet of new EncodedPacketSink(audio).packets()) packets.push([...new Uint8Array(await crypto.subtle.digest("SHA-256", packet.data))].join(","));
      let count = 0, power = 0;
      for await (const sample of new AudioSampleSink(audio).samples()) {
        for (const value of sample.toAudioBuffer().getChannelData(0)) {power += value * value; count++;}
        sample.close();
      }
      return {video: !!await input.getPrimaryVideoTrack(), codec: await audio.getCodec(), duration: await audio.computeDuration(), rms: Math.sqrt(power / count), packets};
    } finally {input.dispose();}
  }, [...bytes]);
  const mp4 = Buffer.from(await make(false)), webm = Buffer.from(await make(true));
  assets.set('/movie.mp4', [mp4, 'video/mp4']); assets.set('/second.webm', [webm, 'video/webm']);
  assets.set('/silent.mp4', [Buffer.from(await make(false, true)), 'video/mp4']);
  await scan(['/movie.mp4'], 'sound');
  await page.locator('#video-export-format-mp3').check();
  assert.match(await page.locator('#export-media-hint').innerText(), /音声だけをMP3/);
  await page.setViewportSize({width: 400, height: 400});
  await page.screenshot({path: '/tmp/harvest-audio-format.png'});
  await page.evaluate(() => {
    window.audioProgress = [];
    new MutationObserver(() => {
      const button = document.querySelector('#export');
      if (button.dataset.saving === 'true') window.audioProgress.push(button.querySelector('.button-label').textContent);
    }).observe(document.querySelector('#export'), {subtree: true, childList: true, characterData: true});
  });
  const output = await saved('recommend');
  const progress = await page.evaluate(() => window.audioProgress);
  assert.ok(progress.length > 2);
  assert.ok(progress.every(label => /^\d+%$/.test(label)), JSON.stringify(progress));
  assert.ok(progress.some(label => parseInt(label) > 63 && parseInt(label) < 90), '音声変換中にも進捗が更新される');
  assert.match(output.filename, /sound\.mp3$/);
  const source = await inspect(mp4), result = await inspect(output.bytes);
  assert.equal(result.video, false); assert.equal(result.codec, 'mp3');
  assert.ok(result.rms > .05); assert.ok(Math.abs(result.duration - source.duration) < .06);
  await scan(['/movie.mp4', '/second.webm'], 'batch');
  const before = await count(); await page.locator('#export').click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'success');
  assert.equal(await count(), before + 2);
  const downloads = await page.evaluate(async () => Promise.all(window.downloadIds.slice(-2).map(async id => (await chrome.downloads.search({id}))[0])));
  assert.deepEqual(downloads.map(item => item.filename.split('/').at(-1)), ['batch_001.mp3', 'batch_002.mp3']);
  const opus = await inspect(await readCompletedDownload(downloads[1].filename));
  assert.equal(opus.video, false); assert.equal(opus.codec, 'mp3'); assert.ok(opus.rms > .05);
  assert.ok(opus.duration > .35 && opus.duration < .5);
  await scan(['/red.png', '/movie.mp4'], 'mixed-audio');
  const zip = entries((await saved('png')).bytes);
  assert.ok(zip.some(item => item.name.endsWith('.png') && item.bytes.equals(redPng)));
  assert.equal((await inspect(zip.find(item => item.name.endsWith('.mp3')).bytes)).video, false);
  await scan(['/movie.mp4', '/silent.mp4'], 'retry-audio');
  assert.match(await failed(), /音声がありません/);
  const fetched = requests().filter(path => path === '/movie.mp4').length;
  assets.set('/silent.mp4', [mp4, 'video/mp4']);
  await page.locator('#export').click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'success');
  assert.equal(requests().filter(path => path === '/movie.mp4').length, fetched, '成功済みの準備を再利用する');
  const checks = await page.evaluate(async bytes => {
    const {prepareAudio} = await import('./media/audio-conversion.js');
    const blob = new Blob([new Uint8Array(bytes)], {type: 'video/mp4'}), result = [];
    try {await prepareAudio(blob, undefined, 64);} catch (error) {result.push(error.message);}
    const controller = new AbortController(); controller.abort();
    try {await prepareAudio(blob, controller.signal);} catch (error) {result.push(error.kind ?? error.name);}
    return result;
  }, [...mp4]);
  assert.match(checks[0], /容量の上限/); assert.equal(checks[1], 'cancelled');
});
