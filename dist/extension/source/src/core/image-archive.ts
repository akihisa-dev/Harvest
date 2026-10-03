import {exportFormatMediaKind, type ImageArchiveFormat} from "./export-formats.js";
import type {ImageItem} from "./images.js";
import {mediaTypeMatchesKind, originalMediaType, type MediaType} from "./media-types.js";
import {storedZipDataLimit, type StoredZipEntry} from "./stored-zip.js";

export class ImageArchiveLimitError extends RangeError {
  constructor() {
    super("ZIP全体がZIP形式の上限を超えています。");
  }
}

function archiveFilename(index: number, count: number, extension: string): string {
  return `${String(index + 1).padStart(Math.max(3, String(count).length), "0")}.${extension}`;
}

function preparedMediaType(blob: Blob): MediaType {
  const mediaType = originalMediaType(blob.type);
  if (!mediaType) throw new RangeError("保存するデータの形式を確認できません。");
  return mediaType;
}

function validatePreparedMedia(item: ImageItem, blob: Blob, format: ImageArchiveFormat): void {
  if (format !== "mp4" && format !== "gif") return;
  const mediaType = preparedMediaType(blob);
  if ((item.kind ?? "image") !== exportFormatMediaKind(format) || mediaType.extension !== format) {
    throw new RangeError("選択項目と保存データの形式が一致しません。");
  }
}

/** Preserve selected order and source Blob identities when naming the archive entries. */
export function createImageZipEntries(
  selected: readonly ImageItem[],
  prepared: ReadonlyMap<ImageItem, Blob>,
  format: ImageArchiveFormat,
): StoredZipEntry[] {
  return selected.map((item, index) => {
    const blob = prepared.get(item);
    if (!blob) throw new RangeError("保存する画像が準備されていません。");
    let extension: string;
    if (format === "original") {
      const mediaType = preparedMediaType(blob);
      if (!mediaTypeMatchesKind(item.kind ?? "image", mediaType.kind)) {
        throw new RangeError("選択項目と保存データの形式が一致しません。");
      }
      extension = mediaType.extension;
    } else {
      extension = format;
      validatePreparedMedia(item, blob, format);
    }
    return {filename: archiveFilename(index, selected.length, extension), blob};
  });
}

/** Owns the payload budget, including retained retry results and final MIME-based names. */
export class ImageArchivePlan {
  private readonly dataLimit: number;
  private preparedSize: number;

  constructor(
    private readonly selected: readonly ImageItem[],
    private readonly prepared: Map<ImageItem, Blob>,
    private readonly format: ImageArchiveFormat,
  ) {
    // .jpg is the shortest recognized original suffix. Check exact names once all are known.
    const extension = format === "original" ? "jpg" : format;
    const filenames = selected.map((_, index) => archiveFilename(index, selected.length, extension));
    this.dataLimit = storedZipDataLimit(filenames);
    this.preparedSize = [...prepared.values()].reduce((size, blob) => size + blob.size, 0);
    if (this.preparedSize > this.dataLimit) throw new ImageArchiveLimitError();
  }

  get remainingBytes(): number { return this.dataLimit - this.preparedSize; }

  retain(item: ImageItem, blob: Blob): void {
    validatePreparedMedia(item, blob, this.format);
    if (blob.size > this.remainingBytes) throw new ImageArchiveLimitError();
    this.prepared.set(item, blob);
    this.preparedSize += blob.size;
  }

  entries(): StoredZipEntry[] {
    const entries = createImageZipEntries(this.selected, this.prepared, this.format);
    const dataLimit = storedZipDataLimit(entries.map(entry => entry.filename));
    if (this.preparedSize > dataLimit) throw new ImageArchiveLimitError();
    return entries;
  }
}
