import { replaceLoneSurrogates, sourceTextGraphemes, sourceGraphemeNeedsImage } from "./source-text.js";
const SOURCE_PAGE_WIDTH = 595;
const SOURCE_PAGE_HEIGHT = 842;
const SOURCE_PAGE_MARGIN = 48;
/** Calculates the shared source-page line breaks, sizes, widths, and baselines. */
export function createSourcePageLayout(source) {
    const heading = replaceLoneSurrogates(source.heading);
    const filename = replaceLoneSurrogates(source.filename);
    const url = replaceLoneSurrogates(source.url);
    const availableWidth = (SOURCE_PAGE_WIDTH - SOURCE_PAGE_MARGIN * 2) * 1000;
    const headingLines = wrapSourceText(prepareSourceText(heading), availableWidth / 18);
    const filenameLines = wrapSourceText(prepareSourceText(filename), availableWidth / 12);
    const fixedHeight = headingLines.length * 25 + filenameLines.length * 18 + 20;
    const availableHeight = Math.max(1, SOURCE_PAGE_HEIGHT - SOURCE_PAGE_MARGIN * 2 - fixedHeight);
    const preparedUrl = prepareSourceText(url);
    const urlUnits = preparedUrl.flat().reduce((total, part) => total + part.width, 0) + (preparedUrl.length - 1) * 600;
    let urlSize = 10;
    let urlLines = wrapSourceText(preparedUrl, availableWidth / urlSize);
    while (urlSize > 0.25 && fixedHeight + urlLines.length * urlSize * 1.4 > availableHeight) {
        urlSize -= 0.25;
        urlLines = wrapSourceText(preparedUrl, availableWidth / urlSize);
    }
    if (fixedHeight + urlLines.length * urlSize * 1.4 > availableHeight) {
        urlSize = Math.max(0.05, Math.sqrt((availableHeight * availableWidth) / Math.max(urlUnits, 1) / 1.4));
        urlLines = wrapSourceText(preparedUrl, availableWidth / urlSize);
    }
    const lines = [];
    let y = SOURCE_PAGE_HEIGHT - SOURCE_PAGE_MARGIN;
    const addSection = (textLines, size, leading) => {
        for (const { text, width: widthUnits } of textLines) {
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
export function sourcePageCharacterWidth(character) {
    return sourceGraphemeNeedsImage(character) ? 1000 : 600;
}
function prepareSourceText(value) {
    return value.split(/\r\n|\r|\n/u).map(paragraph => sourceTextGraphemes(paragraph)
        .map(text => ({ text, width: sourcePageCharacterWidth(text) })));
}
function wrapSourceText(paragraphs, maxWidth) {
    const output = [];
    for (const paragraph of paragraphs) {
        let line = "";
        let width = 0;
        for (const { text, width: characterWidth } of paragraph) {
            if (line !== "" && width + characterWidth > maxWidth) {
                output.push({ text: line, width });
                line = "";
                width = 0;
            }
            line += text;
            width += characterWidth;
        }
        output.push({ text: line, width });
    }
    return output;
}
