/** Runs only inside the isolated worker. */
export async function encodeJxlPixels(image: ImageData): Promise<ArrayBuffer> {
  const codec = await import("harvest-vendor-jxl");
  return codec.default(image, {lossless: true});
}
