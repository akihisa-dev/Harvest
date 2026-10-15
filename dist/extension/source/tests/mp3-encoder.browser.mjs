import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';

test('自作MP3をChromeで復号し、全周波数・左右分離・複合音の誤差・無音・末尾を確認する', {timeout: 90000}, async t => {
  const {page} = await animationPanel(t, new Map());
  const results = await page.evaluate(async () => {
    const {Mp3Encoder} = await import('../core/mp3-encoder.js');
    const results = [];
    for (const rate of [32000, 44100, 48000]) for (const channels of [1, 2]) {
      let seed = 1;
      const planes = Array.from({length: channels}, (_, ch) => Float32Array.from({length: rate}, (_, i) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        return .12 * Math.sin(i * 2 * Math.PI * (ch ? 880 : 440) / rate)
          + .08 * Math.sin(i * 2 * Math.PI * (ch ? 9700 : 6400) / rate) + .015 * seed / 2147483648;
      }));
      const started = performance.now(), encoder = new Mp3Encoder(rate, channels, 100000);
      for (let at = 0; at < rate; at += 1024) encoder.add(planes.map(plane => plane.subarray(at, at + 1024)));
      const blob = encoder.finish(), elapsedMs = performance.now() - started;
      const context = new AudioContext({sampleRate: rate});
      try {
        const decoded = await context.decodeAudioData(await blob.arrayBuffer());
        const checks = planes.map((plane, ch) => {
          const output = decoded.getChannelData(ch);
          let best = {snr: -Infinity, delay: -1, gain: 0, tailRatio: 0};
          // MP3 analysis/overlap introduces a fixed delay; compare aligned PCM, without fitting gain.
          for (let delay = 1000; delay < 1100; delay++) {
            let signal = 0, error = 0, xy = 0, tailIn = 0, tailOut = 0;
            for (let i = 2000; i < rate - 100; i++) {
              const value = output[i + delay] ?? 0;
              signal += plane[i] ** 2; error += (plane[i] - value) ** 2; xy += plane[i] * value;
              if (i > rate - 1000) {tailIn += plane[i] ** 2; tailOut += value ** 2;}
            }
            const snr = 10 * Math.log10(signal / error);
            if (snr > best.snr) best = {snr, delay, gain: xy / signal, tailRatio: tailOut / tailIn};
          }
          return best;
        });
        results.push({rate, channels, decodedRate: decoded.sampleRate, decodedChannels: decoded.numberOfChannels,
          duration: decoded.duration, elapsedMs, checks});
        const silent = new Mp3Encoder(rate, channels, 100000);
        silent.add(Array.from({length: channels}, () => new Float32Array(rate)));
        const quiet = await context.decodeAudioData(await silent.finish().arrayBuffer());
        if (quiet.getChannelData(0).some(value => !Number.isFinite(value) || Math.abs(value) > 1e-6)) throw Error('silence changed');
      } finally {await context.close();}
    }
    return results;
  });
  for (const result of results) {
    assert.equal(result.decodedRate, result.rate); assert.equal(result.decodedChannels, result.channels);
    assert.ok(result.duration >= 1 && result.duration < 1.07);
    for (const check of result.checks) {
      assert.ok(check.snr > 27, JSON.stringify(result));
      assert.ok(Math.abs(check.gain - 1) < .02, JSON.stringify(result));
      assert.ok(check.tailRatio > .94 && check.tailRatio < 1.06, '末尾の音量を保つ');
    }
    console.log(`MP3 ${result.rate}Hz/${result.channels}ch: ${result.checks.map(check => check.snr.toFixed(1)).join('/')}dB, ${result.elapsedMs.toFixed(0)}ms`);
  }
});
