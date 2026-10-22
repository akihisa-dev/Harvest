import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {mp4Bytes} from './media-fixtures.mjs';
import {BufferSource, BufferTarget, EncodedPacket, EncodedPacketSink, EncodedVideoPacketSource, Input, MP4, Mp4OutputFormat, Output} from '../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs';

async function manySamples() {
  const input = new Input({formats: [MP4], source: new BufferSource(mp4Bytes)});
  try {
    const track = await input.getPrimaryVideoTrack();
    const packet = await new EncodedPacketSink(track).getFirstPacket();
    const decoderConfig = await track.getDecoderConfig();
    const target = new BufferTarget(), output = new Output({format: new Mp4OutputFormat(), target});
    const source = new EncodedVideoPacketSource('avc');
    output.addVideoTrack(source);
    await output.start();
    for (let i = 0; i < 500_000; i++) {
      await source.add(new EncodedPacket(packet.data, 'key', i / 30, 1 / 30), {decoderConfig});
    }
    source.close();
    await output.finalize();
    return Buffer.from(target.buffer);
  } finally { input.dispose(); }
}

test('50万サンプルのMP4検査中もタイマー・中止・期限を処理し、検査資源と成功キャッシュを管理する', {timeout: 120_000}, async t => {
  const fixture = await manySamples();
  assert.ok(fixture.length < 64 * 1024 * 1024);
  const {page, scan} = await animationPanel(t, new Map([['/many.mp4', [fixture, 'video/mp4']]]));
  // Use the real extension origin and local fixture server, without starting a save.
  await scan(['/many.mp4']);
  const url = new URL('/many.mp4', await page.locator('#source-url').inputValue()).href;
  const result = await page.evaluate(async url => {
    const {validateOriginalMedia} = await import(chrome.runtime.getURL('app/media/original-media-validation.js'));
    const {Input} = await import(chrome.runtime.getURL('app/vendor/mediabunny/index.js'));
    const bytes = await (await fetch(url)).arrayBuffer();
    let disposed = 0;
    const dispose = Input.prototype.dispose;
    Input.prototype.dispose = function() { disposed++; return dispose.call(this); };
    const createBlob = () => {
      const blob = new Blob([bytes], {type: 'video/mp4'});
      let reads = 0;
      // Exclude asynchronous Blob reading from the responsiveness measurement.
      blob.arrayBuffer = async () => { reads++; return bytes.slice(0); };
      return {blob, reads: () => reads};
    };
    let ticks = 0, longestGap = 0, previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(); longestGap = Math.max(longestGap, now - previous); previous = now; ticks++;
    }, 10);
    const original = createBlob(), started = performance.now();
    try {
      await validateOriginalMedia(original.blob);
      longestGap = Math.max(longestGap, performance.now() - previous);
      const elapsed = performance.now() - started;
      await validateOriginalMedia(original.blob);
      const interruptions = [];
      for (const timed of [false, true]) {
        const controller = new AbortController();
        const signal = timed ? AbortSignal.timeout(20) : controller.signal;
        const abort = timed ? undefined : setTimeout(() => controller.abort(), 20);
        const next = createBlob(), start = performance.now();
        let kind;
        try { await validateOriginalMedia(next.blob, signal); }
        catch (error) { kind = error.kind; }
        finally { clearTimeout(abort); }
        interruptions.push({kind, elapsed: performance.now() - start, reads: next.reads()});
      }
      return {ticks, longestGap, elapsed, disposed, reads: original.reads(), interruptions};
    } finally { clearInterval(timer); Input.prototype.dispose = dispose; }
  }, url);
  t.diagnostic(JSON.stringify({bytes: fixture.length, ...result}));
  assert.ok(result.ticks > 2, '検査中に画面側のタイマーが進む');
  assert.ok(result.longestGap < 1000, `イベント処理が長時間停止しない: ${result.longestGap} ms`);
  assert.equal(result.reads, 1, '検査成功した同一Blobは読み直さない');
  assert.equal(result.disposed, 3, '成功・中止・期限切れで各Inputを解放する');
  for (const interruption of result.interruptions) {
    assert.equal(interruption.kind, 'cancelled');
    assert.ok(interruption.elapsed < 1000, '中止・期限を1秒以内に処理する');
    assert.equal(interruption.reads, 1);
  }
});
