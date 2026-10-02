import { replaceLoneSurrogates } from "./source-text.js";
import type { PdfSourcePageOptions } from "./pdf-types.js";

const SOURCE_PAGE_WIDTH = 595;
const SOURCE_PAGE_HEIGHT = 842;
const SOURCE_PAGE_MARGIN = 48;

export type SourcePageLayoutInput = Pick<PdfSourcePageOptions, "heading" | "filename" | "url">;

export interface SourcePageLayoutLine {
  readonly text: string;
  readonly x: number;
  /** PDF baseline coordinate, measured from the bottom edge of the page. */
  readonly y: number;
  readonly size: number;
  /** Expected text advance in page points, using the PDF source-font widths. */
  readonly width: number;
}

export interface SourcePageLayout {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly lines: readonly SourcePageLayoutLine[];
}

/** Calculates the shared source-page line breaks, sizes, widths, and baselines. */
export function createSourcePageLayout(source: SourcePageLayoutInput): SourcePageLayout {
  const heading = replaceLoneSurrogates(source.heading);
  const filename = replaceLoneSurrogates(source.filename);
  const url = replaceLoneSurrogates(source.url);
  const availableWidth = (SOURCE_PAGE_WIDTH - SOURCE_PAGE_MARGIN * 2) * 1000;
  const headingLines = wrapSourceText(heading, availableWidth / 18);
  const filenameLines = wrapSourceText(filename, availableWidth / 12);
  const fixedHeight = headingLines.length * 25 + filenameLines.length * 18 + 20;
  const availableHeight = Math.max(1, SOURCE_PAGE_HEIGHT - SOURCE_PAGE_MARGIN * 2 - fixedHeight);
  const urlUnits = [...url].reduce((total, character) => total + sourcePageCharacterWidth(character), 0);
  let urlSize = 10;
  let urlLines = wrapSourceText(url, availableWidth / urlSize);
  while (urlSize > 0.25 && fixedHeight + urlLines.length * urlSize * 1.4 > availableHeight) {
    urlSize -= 0.25;
    urlLines = wrapSourceText(url, availableWidth / urlSize);
  }
  if (fixedHeight + urlLines.length * urlSize * 1.4 > availableHeight) {
    urlSize = Math.max(0.05, Math.sqrt((availableHeight * availableWidth) / Math.max(urlUnits, 1) / 1.4));
    urlLines = wrapSourceText(url, availableWidth / urlSize);
  }

  const lines: SourcePageLayoutLine[] = [];
  let y = SOURCE_PAGE_HEIGHT - SOURCE_PAGE_MARGIN;
  const addSection = (textLines: readonly string[], size: number, leading: number): void => {
    for (const text of textLines) {
      const widthUnits = [...text].reduce((total, character) => total + sourcePageCharacterWidth(character), 0);
      lines.push({
        text,
        x: SOURCE_PAGE_MARGIN,
        y,
        size,
        width: widthUnits * size / 1000,
      });
      y -= leading;
    }
    y -= 10;
  };
  addSection(headingLines, 18, 25);
  addSection(filenameLines, 12, 18);
  addSection(urlLines, urlSize, urlSize * 1.4);

  return {
    width: SOURCE_PAGE_WIDTH,
    height: SOURCE_PAGE_HEIGHT,
    margin: SOURCE_PAGE_MARGIN,
    lines,
  };
}

export function sourcePageCharacterWidth(character: string): number {
  return character.codePointAt(0)! <= 0x00ff ? 600 : 1000;
}

function wrapSourceText(value: string, maxWidth: number): string[] {
  const output: string[] = [];
  for (const paragraph of value.split(/\r\n|\r|\n/u)) {
    let line = "";
    let width = 0;
    for (const character of paragraph) {
      const characterWidth = sourcePageCharacterWidth(character);
      if (line !== "" && width + characterWidth > maxWidth) {
        output.push(line);
        line = "";
        width = 0;
      }
      line += character;
      width += characterWidth;
    }
    output.push(line);
  }
  return output;
}
