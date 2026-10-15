import {analysisWindow} from "./mp3-tables.js";

// ISO/IEC 11172-3 Annex C.1.3 matrix and long-block MDCT (C.1.5.2).
const analysisMatrix = Array.from({length: 32}, (_, band) =>
  Float64Array.from({length: 64}, (_, k) => Math.cos((2 * band + 1) * (k - 16) * Math.PI / 64)));
const mdctMatrix = Array.from({length: 18}, (_, k) =>
  Float64Array.from({length: 36}, (_, n) => Math.sin(Math.PI * (n + .5) / 36)
    * Math.cos(Math.PI / 72 * (2 * n + 19) * (2 * k + 1)) / 9));
const alias = [-.6, -.535, -.33, -.185, -.095, -.041, -.0142, -.0037];
const cs = alias.map(value => 1 / Math.sqrt(1 + value * value));
const ca = alias.map((value, index) => value * cs[index]!);

/** One channel's analysis history; PCM and spectral amplitudes both use normalized floats. */
export class Mp3Filterbank {
  private readonly history = new Float64Array(512);
  private previous = new Float64Array(576);

  analyze(pcm: Float32Array): Float64Array {
    if (pcm.length !== 576) throw new Error("MP3の入力音声が不正です。");
    const next = new Float64Array(576), folded = new Float64Array(64);
    for (let time = 0; time < 18; time++) {
      this.history.copyWithin(32, 0, 480);
      for (let n = 0; n < 32; n++) this.history[31 - n] = pcm[time * 32 + n]!;
      for (let i = 0; i < 64; i++) {
        let sum = 0;
        for (let j = 0; j < 8; j++) sum += this.history[i + 64 * j]! * analysisWindow[i + 64 * j]!;
        folded[i] = sum;
      }
      for (let band = 0; band < 32; band++) {
        let sum = 0;
        for (let i = 0; i < 64; i++) sum += analysisMatrix[band]![i]! * folded[i]!;
        // Invert alternate time samples in odd subbands before the hybrid transform.
        next[band * 18 + time] = sum * ((band & 1) && (time & 1) ? -1 : 1);
      }
    }
    const spectrum = new Float64Array(576);
    for (let band = 0; band < 32; band++) for (let k = 0; k < 18; k++) {
      let sum = 0;
      for (let n = 0; n < 36; n++) {
        sum += (n < 18 ? this.previous[band * 18 + n]! : next[band * 18 + n - 18]!) * mdctMatrix[k]![n]!;
      }
      spectrum[band * 18 + k] = sum;
    }
    this.previous = next;
    // Inverse of the decoder alias-reduction butterfly (Annex B.9).
    for (let band = 1; band < 32; band++) for (let i = 0; i < 8; i++) {
      const lower = band * 18 - 1 - i, upper = band * 18 + i;
      const a = spectrum[lower]!, b = spectrum[upper]!;
      spectrum[lower] = a * cs[i]! + b * ca[i]!;
      spectrum[upper] = b * cs[i]! - a * ca[i]!;
    }
    return spectrum;
  }
}
