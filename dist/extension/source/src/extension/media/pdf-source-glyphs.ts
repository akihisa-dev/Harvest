import type { PdfRgbImagePage } from "../../core/pdf-types.js";

const GLYPH_PIXELS = 96;

/** Renders source characters outside Latin-1 with the browser's installed fonts. */
export async function prepareSourceGlyphs(
  values: readonly string[],
  signal?: AbortSignal,
): Promise<Readonly<Record<string, PdfRgbImagePage>>> {
  const glyphs: Record<string, PdfRgbImagePage> = Object.create(null);
  const characters = new Set(values.flatMap(value => [...value].filter(character => character.codePointAt(0)! > 0xff)));
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
      context.font = "72px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
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
