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
/** Own the bitmap and optional canvas until the consumer, including async encoding, settles. */
export async function withDecodedImage(source, policy, consume) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(source);
    }
    catch {
        throw policy.decodeFailure();
    }
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
                context.drawImage(bitmap, 0, 0);
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
