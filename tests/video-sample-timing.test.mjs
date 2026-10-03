import assert from "node:assert/strict";
import test from "node:test";
import {videoSamplesWithDuration} from "../dist/extension/core/video-sample-timing.js";
import {adaptMediabunnyVideoTiming} from "../scripts/mediabunny-build.mjs";

const frame = (timestamp, duration) => ({timestamp, duration, closed: false,
  setDuration(value) { this.duration = value; }, close() { this.closed = true; }});
async function* sequence(frames) { yield* frames; }

test("映像の長さ0は次の表示時刻とコンテナー終端から補い、VFRと既知の長さを保つ", async () => {
  const frames = [frame(0, .04), frame(.04, 0), frame(.17, .08), frame(.25, 0)];
  const seen = [];
  for await (const sample of videoSamplesWithDuration(sequence(frames), async () => .6)) {
    seen.push({timestamp: sample.timestamp, duration: sample.duration});
  }
  assert.deepEqual(seen, [{timestamp: 0, duration: .04}, {timestamp: .04, duration: .13},
    {timestamp: .17, duration: .08}, {timestamp: .25, duration: .35}]);
  assert.ok(frames.every(sample => sample.closed));
});

test("既知の末尾表示時間は共有コンテナー終端で延長しない", async () => {
  const samples = [frame(0, .1), frame(.1, .2)];
  let queried = false;
  for await (const sample of videoSamplesWithDuration(sequence(samples), async () => { queried = true; return 10; })) {
    assert.ok(sample.duration > 0);
  }
  assert.equal(queried, false);
  assert.equal(samples[1].duration, .2);
});

test("根拠のない終端や表示順はフレームを黙って落とさず失敗にする", async () => {
  for (const end of [null, NaN, Infinity, .1, 0]) {
    const sample = frame(.1, 0);
    await assert.rejects(async () => {
      for await (const _ of videoSamplesWithDuration(sequence([sample]), async () => end)) {}
    }, /表示時間/);
    assert.equal(sample.closed, true);
  }
  const samples = [frame(.1, 0), frame(.1, .1)];
  await assert.rejects(async () => {
    for await (const _ of videoSamplesWithDuration(sequence(samples), async () => .2)) {}
  }, /表示時間/);
  assert.ok(samples.every(sample => sample.closed));
});

test("変換を途中で終了しても先読みしたフレームを解放する", async () => {
  const samples = [frame(0, .1), frame(.1, .1), frame(.2, .1)];
  for await (const _ of videoSamplesWithDuration(sequence(samples), async () => .3)) break;
  assert.equal(samples[0].closed, true);
  assert.equal(samples[1].closed, true);
  assert.equal(samples[2].closed, false, "まだ取得していないフレームは所有しない");
});

test("固定版bundleの映像経路だけを補正し、変更された上流bundleは拒否する", () => {
  const video = "Oe.samples(this._startTimestamp,this._endTimestamp)";
  const audio = "v.samples(this._startTimestamp,this._endTimestamp)";
  const source = `let Oe=new _i(t);for await(var ui of ${video}){};${audio};`;
  const adapted = adaptMediabunnyVideoTiming(source);
  assert.ok(adapted.includes(`harvestVideoSamples(${video},()=>t.getDurationFromMetadata())`));
  assert.ok(adapted.includes(audio));
  assert.throws(() => adaptMediabunnyVideoTiming("changed bundle"), /固定版/);
  assert.throws(() => adaptMediabunnyVideoTiming(`${video};${video}`), /固定版/);
});
