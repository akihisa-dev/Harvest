/** Normalizes malformed UTF-16 consistently for layout, glyph lookup, and copy text. */
export function replaceLoneSurrogates(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value.slice(index, index + 2);
        index += 1;
      } else {
        output += "\ufffd";
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      output += "\ufffd";
    } else {
      output += value[index];
    }
  }
  return output;
}


const sourceSegmenter = new Intl.Segmenter("und", {granularity: "grapheme"});

/** Keeps combining marks, variation selectors and joined emoji in one display unit. */
export function sourceTextGraphemes(value: string): string[] {
  return Array.from(sourceSegmenter.segment(value), part => part.segment);
}

export function sourceGraphemeNeedsImage(value: string): boolean {
  return [...value].some(character => character.codePointAt(0)! > 0xff);
}
