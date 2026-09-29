declare module "harvest-vendor-jxl" {
  export default function encode(data: ImageData, options?: {readonly lossless?: boolean}): Promise<ArrayBuffer>;
}
