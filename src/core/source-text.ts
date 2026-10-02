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
