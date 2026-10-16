import { sourceTextGraphemes, sourceGraphemeNeedsImage, sourceTextNeedsLineImage, sourceTextDirection, SOURCE_TEXT_FONT_FAMILY, SOURCE_LINE_EM_PIXELS } from "../../core/source-text.js";
import { createSourcePageLayout } from "../../core/source-page-layout.js";
import type { PdfRgbImagePage, PdfSourcePageOptions, PdfSourceLineImage } from "../../core/pdf-types.js";

const GLYPH_PIXELS = 96;

/** Renders source characters outside Latin-1 with the browser's installed fonts. */
export async function prepareSourceGlyphs(
  values: readonly string[],
  signal?: AbortSignal,
): Promise<Readonly<Record<string, PdfRgbImagePage>>> {
  const glyphs: Record<string, PdfRgbImagePage> = Object.create(null);
  const characters = new Set(values.flatMap(value => sourceTextGraphemes(value).filter(sourceGraphemeNeedsImage)));
  for (const character of characters) {
    if (signal?.aborted) throw new DOMException("PDF creation cancelled.", "AbortError");
    const canvas = document.createElement("canvas");
    canvas.width = GLYPH_PIXELS;
    canvas.height = GLYPH_PIXELS;
    try {
      const context = canvas.getContext("2d", {willReadFrequently: true});
      if (!context) throw new Error("Could not render a PDF source character.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, GLYPH_PIXELS, GLYPH_PIXELS);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `72px ${SOURCE_TEXT_FONT_FAMILY}`;
      context.fillStyle = "#000000";
      context.fillText(character, GLYPH_PIXELS / 2, GLYPH_PIXELS / 2, GLYPH_PIXELS);

      const pixels = context.getImageData(0, 0, GLYPH_PIXELS, GLYPH_PIXELS).data;
      const rgb = new Uint8Array(GLYPH_PIXELS * GLYPH_PIXELS * 3);
      for (let source = 0, target = 0; source < pixels.length; source += 4) {
        rgb[target++] = pixels[source]!;
        rgb[target++] = pixels[source + 1]!;
        rgb[target++] = pixels[source + 2]!;
      }
      const stream = new Blob([rgb.buffer]).stream().pipeThrough(new CompressionStream("deflate"));
      glyphs[character] = {
        rgbFlate: new Uint8Array(await new Response(stream).arrayBuffer()),
        width: GLYPH_PIXELS,
        height: GLYPH_PIXELS,
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return glyphs;
}


/** Keep bidi ordering and contextual letter shaping in the browser's text engine. */
export async function prepareSourcePageText(
  source: Pick<PdfSourcePageOptions, "heading" | "filename" | "url">,
  signal?: AbortSignal,
): Promise<Pick<PdfSourcePageOptions, "glyphs" | "lineImages">> {
  const layout = createSourcePageLayout(source);
  const glyphs = await prepareSourceGlyphs(layout.lines.filter(line => !sourceTextNeedsLineImage(line.text)).map(line => line.text), signal);
  const lineImages: Record<string, PdfSourceLineImage> = Object.create(null);
  for (const line of layout.lines) {
    if (!sourceTextNeedsLineImage(line.text) || lineImages[line.text]) continue;
    if (signal?.aborted) throw new DOMException("PDF creation cancelled.", "AbortError");
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.min(4096, Math.ceil(line.width / line.size * SOURCE_LINE_EM_PIXELS)));
    canvas.height = 128;
    try {
      const context = canvas.getContext("2d", {willReadFrequently: true});
      if (!context) throw new Error("Could not render a PDF source line.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = `${SOURCE_LINE_EM_PIXELS}px ${SOURCE_TEXT_FONT_FAMILY}`;
      context.direction = sourceTextDirection(line.text);
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.fillStyle = "#000000";
      context.scale(canvas.width / Math.max(1, context.measureText(line.text).width), 1);
      context.fillText(line.text, 0, SOURCE_LINE_EM_PIXELS);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const rgb = new Uint8Array(canvas.width * canvas.height * 3);
      for (let src = 0, dest = 0; src < pixels.length; src += 4) {
        rgb[dest++] = pixels[src]!; rgb[dest++] = pixels[src + 1]!; rgb[dest++] = pixels[src + 2]!;
      }
      const stream = new Blob([rgb.buffer]).stream().pipeThrough(new CompressionStream("deflate"));
      lineImages[line.text] = {rgbFlate: new Uint8Array(await new Response(stream).arrayBuffer()), width: canvas.width, height: canvas.height};
    } finally { canvas.width = 0; canvas.height = 0; }
  }
  return {glyphs, lineImages};
}
