import {pdfCopyDirection, pdfCopyMirror, type PdfCopyDirection} from "./pdf-copy-bidi-data.js";

/**
 * Encode a shaped line's selection text for Chrome's PDF text reader.
 * PDFium reconstructs logical text from directional runs, rather than applying
 * the browser's full Unicode bidi algorithm. Keep this compatibility layer
 * separate from display shaping and exercise it through Chrome's actual plugin.
 * Its CMap reader works on UTF-16 units (including surrogate halves), so the
 * compensating sequence must use those same units, not grapheme/scalar reversal.
 * https://github.com/chromium/pdfium/blob/a84323421e94f484faca52dd9d027934eba42ab8/core/fpdftext/cpdf_textpage.cpp
 */
export function sourceLineCopyText(text: string): string {
  const runs: {direction: PdfCopyDirection; units: number[]}[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index), direction = pdfCopyDirection(unit);
    const previous = runs.at(-1);
    if (previous?.direction === direction) previous.units.push(unit);
    else runs.push({direction, units: [unit]});
  }
  const right = runs.filter(run => run.direction === "R").length;
  const left = runs.filter(run => run.direction === "L").length;
  const rtl = right > left;
  let direction: PdfCopyDirection = rtl ? "R" : "L";
  const encoded = runs.map(run => {
    if (run.direction === "R" || (run.direction === "N" && direction === "R")) {
      direction = "R";
      return [...run.units].reverse().map(pdfCopyMirror).map(unit => String.fromCharCode(unit)).join("");
    }
    if (run.direction !== "W") direction = "L";
    return run.units.map(unit => String.fromCharCode(unit)).join("");
  });
  return (rtl ? [...encoded].reverse() : encoded).join("");
}
