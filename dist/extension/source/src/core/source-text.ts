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


export const SOURCE_TEXT_FONT_FAMILY = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
export const SOURCE_LINE_EM_PIXELS = 96;

/** Let the browser shape full lines containing RTL scripts or direction controls. */
export function sourceTextNeedsLineImage(value: string): boolean {
  return /[\u0590-\u08ff\u200e\u200f\u202a-\u202e\u2066-\u2069\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1eeff}]/u.test(value);
}


/** Choose the paragraph direction from the first strong letter or direction mark. */
export function sourceTextDirection(value: string): "ltr" | "rtl" {
  for (const character of value) {
    if (character === "\u200f") return "rtl";
    if (character === "\u200e") return "ltr";
    if (/\p{Letter}/u.test(character)) return sourceTextNeedsLineImage(character) ? "rtl" : "ltr";
  }
  return "ltr";
}
