interface ColorBin { readonly key: number; readonly count: number; readonly rgb: readonly number[]; }
interface ColorBox { readonly colors: readonly ColorBin[]; readonly axis: number; readonly score: number; }

/** Per-frame exact colors where GIF permits them; weighted median cut otherwise. */
export function gifPalette(rgba: Uint8ClampedArray, reserveTransparency = false): {palette: Uint8Array; indices: Uint8Array; transparent: boolean} {
  const exact = new Map<number, number>();
  const counts = new Uint32Array(32768), sums = new Float64Array(32768 * 3);
  let transparent = reserveTransparency;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3]! < 128) { transparent = true; continue; }
    const r = rgba[offset]!, g = rgba[offset + 1]!, b = rgba[offset + 2]!;
    const color = (r << 16) | (g << 8) | b;
    if (exact.size <= 256 && !exact.has(color)) exact.set(color, exact.size);
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    counts[key] = counts[key]! + 1;
    sums[key * 3] = sums[key * 3]! + r;
    sums[key * 3 + 1] = sums[key * 3 + 1]! + g;
    sums[key * 3 + 2] = sums[key * 3 + 2]! + b;
  }
  const start = transparent ? 1 : 0, capacity = 256 - start;
  const palette = new Uint8Array(768), indices = new Uint8Array(rgba.length / 4);
  if (exact.size <= capacity) {
    for (const [color, index] of exact) {
      const at = (index + start) * 3;
      palette[at] = color >> 16; palette[at + 1] = (color >> 8) & 255; palette[at + 2] = color & 255;
    }
    for (let p = 0; p < indices.length; p++) {
      const at = p * 4;
      indices[p] = rgba[at + 3]! < 128 ? 0 : exact.get((rgba[at]! << 16) | (rgba[at + 1]! << 8) | rgba[at + 2]!)! + start;
    }
    return {palette, indices, transparent};
  }
  const bins: ColorBin[] = [];
  for (let key = 0; key < counts.length; key++) {
    const count = counts[key]!;
    if (count) bins.push({key, count, rgb: [sums[key * 3]! / count, sums[key * 3 + 1]! / count, sums[key * 3 + 2]! / count]});
  }
  const box = (colors: readonly ColorBin[]): ColorBox => {
    let axis = 0, variance = 0;
    const weight = colors.reduce((sum, color) => sum + color.count, 0);
    for (let channel = 0; channel < 3; channel++) {
      const mean = colors.reduce((sum, color) => sum + color.count * color.rgb[channel]!, 0) / weight;
      const value = colors.reduce((sum, color) => sum + color.count * (color.rgb[channel]! - mean) ** 2, 0);
      if (value > variance) { variance = value; axis = channel; }
    }
    return {colors, axis, score: colors.length > 1 ? variance : -1};
  };
  const boxes = [box(bins)];
  while (boxes.length < capacity) {
    let selected = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i]!.score >= 0 && (selected < 0 || boxes[i]!.score > boxes[selected]!.score)) selected = i;
    if (selected < 0) break;
    const current = boxes[selected]!, sorted = [...current.colors].sort((a, b) => a.rgb[current.axis]! - b.rgb[current.axis]!);
    const half = sorted.reduce((sum, color) => sum + color.count, 0) / 2;
    let split = 0, weight = 0;
    do { weight += sorted[split++]!.count; } while (weight < half && split < sorted.length - 1);
    boxes.splice(selected, 1, box(sorted.slice(0, split)), box(sorted.slice(split)));
  }
  const colors = boxes.map(current => {
    const weight = current.colors.reduce((sum, color) => sum + color.count, 0);
    return [0, 1, 2].map(channel => Math.round(current.colors.reduce((sum, color) => sum + color.count * color.rgb[channel]!, 0) / weight));
  });
  colors.forEach((color, index) => palette.set(color, (index + start) * 3));
  const lookup = new Uint8Array(32768);
  for (const bin of bins) {
    let nearest = 0, distance = Infinity;
    colors.forEach((color, index) => {
      const value = color.reduce((sum, channel, at) => sum + (channel - bin.rgb[at]!) ** 2, 0);
      if (value < distance) { nearest = index; distance = value; }
    });
    lookup[bin.key] = nearest + start;
  }
  for (let p = 0; p < indices.length; p++) {
    const at = p * 4;
    indices[p] = rgba[at + 3]! < 128 ? 0 : lookup[((rgba[at]! >> 3) << 10) | ((rgba[at + 1]! >> 3) << 5) | (rgba[at + 2]! >> 3)]!;
  }
  return {palette, indices, transparent};
}
