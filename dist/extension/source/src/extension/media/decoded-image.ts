import {checkCancelled, fetchedImageDimensions, imageDimensionsError, type FetchedImage} from "../contracts/image-data-contract.js";

interface DecodePolicy {
  readonly signal: AbortSignal | undefined;
  /** Retrieval and conversion retain their established cancellation/error precedence. */
  decodeFailure(): Error;
  invalidDimensions(message: string): Error;
}

interface CanvasPolicy {
  readonly context: CanvasRenderingContext2DSettings;
  readonly opaque: boolean;
  invalidSize(): Error;
  unavailable(): Error;
}

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  canvas(policy: CanvasPolicy): {canvas: HTMLCanvasElement; context: CanvasRenderingContext2D};
}

/** Reject header dimensions before allocating decoded pixels in either export path. */
export async function validateFetchedDimensions(
  fetched: FetchedImage,
  signal: AbortSignal | undefined,
  invalidDimensions: (message: string) => Error,
): Promise<void> {
  const dimensions = await fetchedImageDimensions(fetched);
  checkCancelled(signal);
  if (!dimensions) return;
  const error = imageDimensionsError(dimensions.width, dimensions.height);
  if (error) throw invalidDimensions(error);
}

/** Stop waiting for native image work; dispose any result arriving after cancellation. */
export function waitForImageOperation<T>(operation: Promise<T>, signal?: AbortSignal, discard?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => { signal?.removeEventListener("abort", abort); };
    const abort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try { checkCancelled(signal); } catch (error) { reject(error); }
    };
    operation.then(value => {
      if (settled) { discard?.(value); return; }
      settled = true;
      cleanup();
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    signal?.addEventListener("abort", abort, {once: true});
    if (signal?.aborted) abort();
  });
}

/** Own the bitmap and optional canvas until the consumer, including async encoding, settles. */
export async function withDecodedImage<T>(
  source: Blob,
  policy: DecodePolicy,
  consume: (image: DecodedImage) => T | Promise<T>,
): Promise<T> {
  checkCancelled(policy.signal);
  const decoding = createImageBitmap(source).catch(() => { throw policy.decodeFailure(); });
  const bitmap = await waitForImageOperation(decoding, policy.signal, late => late.close());
  let canvas: HTMLCanvasElement | undefined;
  try {
    checkCancelled(policy.signal);
    const {width, height} = bitmap;
    const error = imageDimensionsError(width, height);
    if (error) throw policy.invalidDimensions(error);
    return await consume({
      width,
      height,
      canvas(canvasPolicy) {
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        if (canvas.width !== width || canvas.height !== height) throw canvasPolicy.invalidSize();
        const context = canvas.getContext("2d", canvasPolicy.context);
        if (!context) throw canvasPolicy.unavailable();
        if (canvasPolicy.opaque) {
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
        }
        context.drawImage(bitmap, 0, 0);
        return {canvas, context};
      },
    });
  } finally {
    bitmap.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
