import type { PdfImagePage } from "../core/pdf-types.js";
import { checkCancelled, fetchedImageDimensions, imageDimensionsError, invalidImage, validatePositiveInteger, type FetchedImage, type ImageDataOptions } from "./image-data-contract.js";

const DEFAULT_PIXEL_CHUNK_PIXELS = 262_144;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function decodeImage(fetched: FetchedImage, options: ImageDataOptions): Promise<PdfImagePage> {
  checkCancelled(options.signal);
  const headerDimensions = await fetchedImageDimensions(fetched);
  checkCancelled(options.signal);
  if (headerDimensions) {
    const dimensionsError = imageDimensionsError(headerDimensions.width, headerDimensions.height);
    if (dimensionsError) throw invalidImage(dimensionsError);
  }
  if (fetched.kind === "original") return fetched.page;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(fetched.blob);
  } catch {
    throw invalidImage("画像を読み込めませんでした。形式が対応していないか、データが壊れています。");
  }

  let canvas: HTMLCanvasElement | undefined;
  try {
    checkCancelled(options.signal);
    const width = bitmap.width;
    const height = bitmap.height;
    const dimensionsError = imageDimensionsError(width, height);
    if (dimensionsError) throw invalidImage(dimensionsError);

    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    if (canvas.width !== width || canvas.height !== height) {
      throw invalidImage("画像が大きすぎてPDF用に変換できませんでした。");
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw invalidImage("画像をPDF用に変換できませんでした。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0);

    const requestedRows = options.pixelRowsPerChunk;
    if (requestedRows !== undefined) validatePositiveInteger(requestedRows, "pixelRowsPerChunk");
    const maximumRowsPerChunk = Math.max(1, Math.floor(DEFAULT_PIXEL_CHUNK_PIXELS / width));
    const rowsPerChunk = Math.min(requestedRows ?? maximumRowsPerChunk, maximumRowsPerChunk);
    let nextY = 0;
    let nextX = 0;

    try {
      checkCancelled(options.signal);
      const pixels = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            checkCancelled(options.signal);
            if (nextY >= height) {
              controller.close();
              return;
            }

            // Very wide images are also split across columns so even a single row
            // cannot create a large temporary RGB array.
            const splitColumns = width > DEFAULT_PIXEL_CHUNK_PIXELS;
            const x = splitColumns ? nextX : 0;
            const chunkWidth = splitColumns
              ? Math.min(DEFAULT_PIXEL_CHUNK_PIXELS, width - nextX)
              : width;
            const rows = splitColumns ? 1 : Math.min(rowsPerChunk, height - nextY);
            let rgba: Uint8ClampedArray;
            try {
              rgba = context.getImageData(x, nextY, chunkWidth, rows).data;
            } catch {
              throw invalidImage("画像をPDF用に変換できませんでした。");
            }
            const expectedLength = chunkWidth * rows * 4;
            if (rgba.length < expectedLength) {
              throw invalidImage("画像をPDF用に変換できませんでした。");
            }
            const rgb = new Uint8Array((expectedLength / 4) * 3);
            for (let source = 0, target = 0; source < expectedLength; source += 4) {
              rgb[target++] = rgba[source] ?? 0;
              rgb[target++] = rgba[source + 1] ?? 0;
              rgb[target++] = rgba[source + 2] ?? 0;
            }

            if (splitColumns) {
              nextX += chunkWidth;
              if (nextX === width) {
                nextX = 0;
                nextY += 1;
              }
            } else {
              nextY += rows;
            }
            controller.enqueue(rgb);
            if (nextY < height) await yieldToEventLoop();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      // CompressionStream's DOM declaration accepts any BufferSource, although
      // this stream deliberately feeds and reads byte arrays only.
      const compressor = new CompressionStream("deflate") as unknown as TransformStream<Uint8Array, Uint8Array>;
      const stream = pixels.pipeThrough(
        compressor,
        options.signal ? { signal: options.signal } : undefined,
      );
      const reader = stream.getReader();
      const cancelRead = (): void => { void reader.cancel().catch(() => {}); };
      options.signal?.addEventListener("abort", cancelRead, { once: true });
      try {
        checkCancelled(options.signal);
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          checkCancelled(options.signal);
          if (done) break;
          chunks.push(value);
          length += value.byteLength;
        }
        const rgbFlate = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          rgbFlate.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return { rgbFlate, width, height };
      } finally {
        options.signal?.removeEventListener("abort", cancelRead);
        reader.releaseLock();
      }
    } catch {
      checkCancelled(options.signal);
      throw invalidImage("画像をPDF用に変換できませんでした。");
    }
  } finally {
    bitmap.close();
    // Release the browser's backing store as soon as the compressed page exists.
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
