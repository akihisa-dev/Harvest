import { checkCancelled, fetchedImageDimensions, imageDimensionsError } from "../contracts/image-data-contract.js";
/** Reject header dimensions before allocating decoded pixels in either export path. */
export async function validateFetchedDimensions(fetched, signal, invalidDimensions) {
    const dimensions = await fetchedImageDimensions(fetched);
    checkCancelled(signal);
    if (!dimensions)
        return;
    const error = imageDimensionsError(dimensions.width, dimensions.height);
    if (error)
        throw invalidDimensions(error);
}
/** Stop waiting for native image work; dispose any result arriving after cancellation. */
export function waitForImageOperation(operation, signal, discard) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => { signal?.removeEventListener("abort", abort); };
        const abort = () => {
            if (settled)
                return;
            settled = true;
            cleanup();
            try {
                checkCancelled(signal);
            }
            catch (error) {
                reject(error);
            }
        };
        operation.then(value => {
            if (settled) {
                discard?.(value);
                return;
            }
            settled = true;
            cleanup();
            resolve(value);
        }, error => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(error);
        });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted)
            abort();
    });
}
async function loadDrawable(source, policy) {
    if (source.type.split(";", 1)[0] !== "image/svg+xml") {
        const decoding = createImageBitmap(source).catch(() => { throw policy.decodeFailure(); });
        const bitmap = await waitForImageOperation(decoding, policy.signal, late => late.close());
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    }
    // SVG in an image element disables scripts and external resource loading.
    // Never insert the SVG markup into the extension document.
    const image = new Image();
    const url = URL.createObjectURL(source);
    const close = () => { image.removeAttribute("src"); URL.revokeObjectURL(url); };
    try {
        image.src = url;
        await waitForImageOperation(image.decode().catch(() => { throw policy.decodeFailure(); }), policy.signal);
        return { source: image, width: image.naturalWidth, height: image.naturalHeight, close };
    }
    catch (error) {
        close();
        throw error;
    }
}
/** Own the decoded image and optional canvas until async encoding settles. */
export async function withDecodedImage(source, policy, consume) {
    checkCancelled(policy.signal);
    const bitmap = await loadDrawable(source, policy);
    let canvas;
    try {
        checkCancelled(policy.signal);
        const { width, height } = bitmap;
        const error = imageDimensionsError(width, height);
        if (error)
            throw policy.invalidDimensions(error);
        return await consume({
            width,
            height,
            canvas(canvasPolicy) {
                canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                if (canvas.width !== width || canvas.height !== height)
                    throw canvasPolicy.invalidSize();
                const context = canvas.getContext("2d", canvasPolicy.context);
                if (!context)
                    throw canvasPolicy.unavailable();
                if (canvasPolicy.opaque) {
                    context.fillStyle = "#ffffff";
                    context.fillRect(0, 0, width, height);
                }
                context.drawImage(bitmap.source, 0, 0);
                return { canvas, context };
            },
        });
    }
    finally {
        bitmap.close();
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
}
