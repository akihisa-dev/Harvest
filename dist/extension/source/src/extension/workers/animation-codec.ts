import {getImageDimensions} from "../../core/image-dimensions.js";
import {GifEncoder} from "../../core/gif-encoder.js";
import {animatedImageType, declaredAnimationFrames} from "../../core/animated-image.js";
import {imageDimensionsError, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS} from "../contracts/image-data-contract.js";
import type {AnimationDecoder, AnimationDecoderConstructor} from "../contracts/image-decoder.js";

/** Inspect transparency first; reserve its GIF index consistently across the whole animation. */
export async function convertAnimatedImage(blob: Blob, maxBytes: number): Promise<Blob | null> {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("画像が大きすぎるため、処理できません。");
  const data = await blob.arrayBuffer(), bytes = new Uint8Array(data), type = animatedImageType(bytes);
  if (!type) return null;
  const dimensions = getImageDimensions(bytes), declared = declaredAnimationFrames(bytes,type);
  if (dimensions) {
    const error = imageDimensionsError(dimensions.width,dimensions.height);
    if (error) throw new Error(error);
    if (declared !== null && dimensions.width * dimensions.height * declared > MAX_IMAGE_PIXELS) throw new Error("アニメーション画像の展開量が上限を超えています。");
  }
  if (declared !== null && (declared < 1 || declared > 10000)) throw new Error("アニメーション画像のフレームを保持できません。");
  const Decoder = (globalThis as typeof globalThis & {ImageDecoder?: AnimationDecoderConstructor}).ImageDecoder;
  if (!Decoder || !await Decoder.isTypeSupported(type)) throw new Error("この環境では動く画像をGIFへ変換できません。originalを選んで保存してください。");
  let decoder: AnimationDecoder | undefined, canvas: OffscreenCanvas | undefined;
  try {
    decoder = new Decoder({data,type,preferAnimation:true});
    await decoder.tracks.ready;await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (declared !== null && track?.frameCount !== declared) throw new Error("アニメーション画像のデータが不完全または破損しています。");
    if (!track || !track.animated || !Number.isSafeInteger(track.frameCount) || track.frameCount < 1 || track.frameCount > 10000) throw new Error("アニメーション画像のフレームを保持できません。");
    if (dimensions && dimensions.width * dimensions.height * track.frameCount > MAX_IMAGE_PIXELS) throw new Error("アニメーション画像の展開量が上限を超えています。");
    const pixels = async (index: number): Promise<{rgba: Uint8ClampedArray; duration: number}> => {
      const {image,complete} = await decoder!.decode({frameIndex:index,completeFramesOnly:true});
      try {
        const width = image.displayWidth, height = image.displayHeight, error = imageDimensionsError(width,height);
        if (error) throw new Error(error);
        if (!complete) throw new Error("アニメーション画像のデータが不完全または破損しています。");
        canvas ??= new OffscreenCanvas(width,height);
        if (canvas.width !== width || canvas.height !== height) throw new Error("アニメーション画像のフレームの大きさが一致しません。");
        const context = canvas.getContext("2d",{willReadFrequently:true});
        if (!context) throw new Error("GIFへ変換できませんでした。");
        context.clearRect(0,0,width,height);context.drawImage(image,0,0);
        return {rgba:context.getImageData(0,0,width,height).data,duration:image.duration ?? 0};
      } finally {image.close();}
    };
    let transparent = false, logicalPixels = 0;
    for (let index = 0; index < track.frameCount; index++) {
      const {rgba,duration} = await pixels(index);
      logicalPixels += rgba.length / 4;
      if (logicalPixels > MAX_IMAGE_PIXELS) throw new Error("アニメーション画像の展開量が上限を超えています。");
      if (!Number.isFinite(duration) || duration < 10000) throw new Error("GIFの10ms刻みではフレームの表示時間を保持できません。originalを選んで保存してください。");
      for (let offset = 3; offset < rgba.length; offset += 4) if (rgba[offset]! < 128) {transparent=true;break;}
    }
    const encoder = new GifEncoder(canvas!.width,canvas!.height,track.repetitionCount,Math.min(maxBytes,MAX_IMAGE_BYTES),transparent);
    for (let index = 0; index < track.frameCount; index++) {
      const {rgba,duration} = await pixels(index);
      encoder.add(rgba,duration);
    }
    // A second-pass failure never returns a partial successful GIF.
    return encoder.finish();
  } finally {
    decoder?.close();
    if (canvas) {canvas.width=0;canvas.height=0;}
  }
}
