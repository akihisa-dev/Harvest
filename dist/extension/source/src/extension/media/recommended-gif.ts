import {normalizeMediaMimeType} from "../../core/media-types.js";
import {checkCancelled, invalidImage, type FetchedImage} from "../contracts/image-data-contract.js";
import {validateOriginalMedia} from "./original-media-validation.js";
import {withDecodedImage} from "./decoded-image.js";

/** Refine an image URL hint using the already fetched MIME and validated GIF data. */
export async function prepareRecommendedGif(fetched: FetchedImage, signal?: AbortSignal): Promise<Blob | null> {
  checkCancelled(signal);
  if (fetched.kind !== "bitmap") return null;
  const header = String.fromCharCode(...new Uint8Array(await fetched.blob.slice(0, 6).arrayBuffer()));
  checkCancelled(signal);
  const gifBytes = header === "GIF87a" || header === "GIF89a";
  const gifMime = normalizeMediaMimeType(fetched.blob.type) === "image/gif";
  if (!gifBytes && !gifMime) return null;
  if (!gifBytes || !gifMime) throw invalidImage("メディアの種類とデータが一致しません。");
  const blob = fetched.blob.type === "image/gif" ? fetched.blob : new Blob([fetched.blob], {type: "image/gif"});
  await validateOriginalMedia(blob, signal);
  await withDecodedImage(blob, {
    signal, invalidDimensions: invalidImage,
    decodeFailure: () => invalidImage("画像を読み込めませんでした。形式が対応していないか、データが壊れています。"),
  }, () => {});
  checkCancelled(signal);
  return blob;
}
