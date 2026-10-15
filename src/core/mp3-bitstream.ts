import {huffman16Codes, huffman16Lengths} from "./mp3-tables.js";

export class Mp3Bits {
  readonly bytes: Uint8Array<ArrayBuffer>;
  position = 0;
  constructor(size: number) { this.bytes = new Uint8Array(size); }
  write(value: number, length: number): void {
    if (this.position + length > this.bytes.length * 8) throw new Error("MP3の保存データが不正です。");
    for (let bit = length - 1; bit >= 0; bit--) {
      if ((value >>> bit) & 1) this.bytes[this.position >>> 3]! |= 1 << (7 - (this.position & 7));
      this.position++;
    }
  }
}
export interface Mp3Granule {
  readonly gain: number;
  readonly values: Int32Array;
  readonly length: number;
  readonly linbits: number;
  readonly table: number;
  readonly bits: number;
}
const linbits = [1, 2, 3, 4, 6, 8, 10, 13];

/** Fit each granule in its own frame. No bit reservoir or cross-frame references. */
export function quantizeMp3(spectrum: Float64Array, budget: number): Mp3Granule {
  const powers = Float64Array.from(spectrum, value => Math.abs(value) ** .75);
  const peak = Math.max(...powers);
  // Requantization is sign(q) * abs(q)^(4/3) * 2^((global_gain-210)/4).
  let gain = peak ? Math.max(0, Math.floor(210 + 16 / 3 * Math.log2(peak / 8190))) : 0;
  for (; gain <= 255; gain++) {
    const scale = 2 ** ((gain - 210) * 3 / 16);
    const values = Int32Array.from(powers, value => Math.floor(value / scale + .4054));
    const maximum = Math.max(...values);
    const tableIndex = linbits.findIndex(count => maximum <= 15 + 2 ** count - 1);
    if (tableIndex < 0) continue;
    const extra = linbits[tableIndex]!;
    let length = 576;
    while (length > 0 && values[length - 1] === 0) length--;
    length += length & 1;
    let bits = 0;
    for (let i = 0; i < length; i += 2) {
      const a = values[i]!, b = values[i + 1]!;
      bits += huffman16Lengths[Math.min(a, 15) * 16 + Math.min(b, 15)]!
        + Number(a > 0) + Number(b > 0) + (a >= 15 ? extra : 0) + (b >= 15 ? extra : 0);
    }
    if (bits <= budget) {
      for (let i = 0; i < length; i++) if (spectrum[i]! < 0) values[i] = -values[i]!;
      return {gain, values, length, linbits: extra, table: 16 + tableIndex, bits};
    }
  }
  throw new Error("音声をMP3へ変換できませんでした。");
}

export function writeMp3SideInfo(bits: Mp3Bits, granules: readonly Mp3Granule[], channels: number): void {
  bits.write(0, 9); // main_data_begin = 0: every frame owns all its main data.
  bits.write(0, channels === 1 ? 5 : 3);
  for (let channel = 0; channel < channels; channel++) bits.write(0, 4); // scfsi
  for (const granule of granules) {
    bits.write(granule.bits, 12); bits.write(granule.length / 2, 9); bits.write(granule.gain, 8);
    bits.write(0, 4); // scalefac_compress: all long-block scale factors are zero.
    bits.write(0, 1); // window_switching_flag: long blocks.
    for (let region = 0; region < 3; region++) bits.write(granule.table, 5);
    bits.write(7, 4); bits.write(7, 3); // Legal region boundaries; the same table covers all three.
    bits.write(0, 1); bits.write(0, 1); bits.write(0, 1); // preflag, scalefac_scale, count1table_select
  }
}
export function writeMp3Granule(bits: Mp3Bits, granule: Mp3Granule): void {
  for (let i = 0; i < granule.length; i += 2) {
    const x = granule.values[i]!, y = granule.values[i + 1]!;
    const a = Math.abs(x), b = Math.abs(y), index = Math.min(a, 15) * 16 + Math.min(b, 15);
    bits.write(huffman16Codes[index]!, huffman16Lengths[index]!);
    if (a >= 15) bits.write(a - 15, granule.linbits);
    if (a) bits.write(Number(x < 0), 1);
    if (b >= 15) bits.write(b - 15, granule.linbits);
    if (b) bits.write(Number(y < 0), 1);
  }
}
