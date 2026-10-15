import {Mp3Filterbank} from "./mp3-filterbank.js";
import {Mp3Bits, quantizeMp3, writeMp3Granule, writeMp3SideInfo, type Mp3Granule} from "./mp3-bitstream.js";

/** Self-contained MPEG-1 Layer III, 320 kbps, independent mono/stereo channels.
 * Input is streamed in normalized PCM planes. Working PCM never exceeds one frame per channel.
 */
export class Mp3Encoder {
  private readonly filterbanks: Mp3Filterbank[];
  private readonly pending: Float32Array[];
  private readonly frames: Uint8Array<ArrayBuffer>[] = [];
  private used = 0;
  private remainder = 0;
  private bytes = 0;
  private finished = false;
  private samples = 0;

  constructor(readonly sampleRate: number, readonly channels: number, private readonly maxBytes: number) {
    if (![32000, 44100, 48000].includes(sampleRate) || ![1, 2].includes(channels)) {
      throw new Error("MP3保存は32・44.1・48kHzのモノラル・ステレオ音声に対応しています。");
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("音声データが保存容量の上限を超えています。");
    this.filterbanks = Array.from({length: channels}, () => new Mp3Filterbank());
    this.pending = Array.from({length: channels}, () => new Float32Array(1152));
  }

  add(planes: readonly Float32Array[]): void {
    if (this.finished || planes.length !== this.channels || !planes[0]
      || planes.some(plane => plane.length !== planes[0]!.length)) throw new Error("MP3の入力音声が不正です。");
    for (let at = 0; at < planes[0].length;) {
      const take = Math.min(1152 - this.used, planes[0].length - at);
      for (let channel = 0; channel < this.channels; channel++) {
        const source = planes[channel]!.subarray(at, at + take);
        if (source.some(value => !Number.isFinite(value))) throw new Error("MP3の入力音声が不正です。");
        this.pending[channel]!.set(source, this.used);
      }
      this.used += take; at += take; this.samples += take;
      if (this.used === 1152) {this.encodeFrame(); this.used = 0;}
    }
  }

  finish(): Blob {
    if (this.finished || !this.samples) throw new Error("音声を取り出した結果が空です。");
    this.finished = true;
    if (this.used) {
      for (const plane of this.pending) plane.fill(0, this.used);
      this.encodeFrame();
    }
    // Flush the analysis filter and MDCT overlap; keep the last audible samples.
    for (const plane of this.pending) plane.fill(0);
    this.encodeFrame();
    const blob = new Blob(this.frames, {type: "audio/mpeg"});
    this.frames.length = 0;
    return blob;
  }

  private encodeFrame(): void {
    const numerator = 144 * 320000;
    this.remainder += numerator % this.sampleRate;
    const padding = this.remainder >= this.sampleRate ? 1 : 0;
    if (padding) this.remainder -= this.sampleRate;
    const size = Math.floor(numerator / this.sampleRate) + padding, sideSize = this.channels === 1 ? 17 : 32;
    if (size > this.maxBytes - this.bytes) throw new Error("音声データが保存容量の上限を超えています。");
    const budget = Math.min(4095, Math.floor((size - 4 - sideSize) * 8 / (2 * this.channels)));
    const granules: Mp3Granule[] = [];
    for (let granule = 0; granule < 2; granule++) for (let channel = 0; channel < this.channels; channel++) {
      granules.push(quantizeMp3(this.filterbanks[channel]!.analyze(this.pending[channel]!.subarray(granule * 576, (granule + 1) * 576)), budget));
    }
    const bits = new Mp3Bits(size);
    bits.write(0x7ff, 11); bits.write(3, 2); bits.write(1, 2); bits.write(1, 1); // MPEG-1 Layer III, no CRC
    bits.write(14, 4); bits.write([44100, 48000, 32000].indexOf(this.sampleRate), 2); // 320 kbps
    bits.write(padding, 1); bits.write(0, 1); bits.write(this.channels === 1 ? 3 : 0, 2);
    bits.write(0, 2); bits.write(0, 1); bits.write(1, 1); bits.write(0, 2);
    writeMp3SideInfo(bits, granules, this.channels);
    if (bits.position !== (4 + sideSize) * 8) throw new Error("MP3の保存データが不正です。");
    for (const granule of granules) writeMp3Granule(bits, granule);
    this.frames.push(bits.bytes); this.bytes += size;
  }
}
