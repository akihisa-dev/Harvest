// The pinned 1.61.0 Conversion trims zero-duration video samples before encoding.
// Adapt its video iterator only; leave the decoder, timestamps, and audio path intact.
export function adaptMediabunnyVideoTiming(source) {
  const original = "Oe.samples(this._startTimestamp,this._endTimestamp)";
  if (source.split(original).length !== 2 || !source.includes(`let Oe=new _i(t);for await(var ui of ${original})`)) {
    throw new Error("固定版mediabunnyの映像変換経路を確認できません。");
  }
  return 'import {videoSamplesWithDuration as harvestVideoSamples} from "../../../core/video-sample-timing.js";\n'
    + source.replace(original, `harvestVideoSamples(${original},()=>t.getDurationFromMetadata())`);
}
