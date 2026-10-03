import { exportFormatMediaKind } from "./export-formats.js";
import { mediaTypeMatchesKind, originalMediaType } from "./media-types.js";
import { storedZipDataLimit } from "./stored-zip.js";
export class ImageArchiveLimitError extends RangeError {
    constructor() {
        super("ZIP全体がZIP形式の上限を超えています。");
    }
}
function archiveFilename(index, count, extension) {
    return `${String(index + 1).padStart(Math.max(3, String(count).length), "0")}.${extension}`;
}
function preparedMediaType(blob) {
    const mediaType = originalMediaType(blob.type);
    if (!mediaType)
        throw new RangeError("保存するデータの形式を確認できません。");
    return mediaType;
}
function validatePreparedMedia(item, blob, format) {
    if (format !== "mp4" && format !== "gif")
        return;
    const mediaType = preparedMediaType(blob);
    if ((item.kind ?? "image") !== exportFormatMediaKind(format) || mediaType.extension !== format) {
        throw new RangeError("選択項目と保存データの形式が一致しません。");
    }
}
/** Preserve selected order and source Blob identities when naming the archive entries. */
export function createImageZipEntries(selected, prepared, format) {
    return selected.map((item, index) => {
        const blob = prepared.get(item);
        if (!blob)
            throw new RangeError("保存する画像が準備されていません。");
        let extension;
        if (format === "original") {
            const mediaType = preparedMediaType(blob);
            if (!mediaTypeMatchesKind(item.kind ?? "image", mediaType.kind)) {
                throw new RangeError("選択項目と保存データの形式が一致しません。");
            }
            extension = mediaType.extension;
        }
        else {
            extension = format;
            validatePreparedMedia(item, blob, format);
        }
        return { filename: archiveFilename(index, selected.length, extension), blob };
    });
}
/** Owns the payload budget, including retained retry results and final MIME-based names. */
export class ImageArchivePlan {
    selected;
    prepared;
    format;
    dataLimit;
    preparedSize;
    constructor(selected, prepared, format) {
        this.selected = selected;
        this.prepared = prepared;
        this.format = format;
        // .jpg is the shortest recognized original suffix. Check exact names once all are known.
        const extension = format === "original" ? "jpg" : format;
        const filenames = selected.map((_, index) => archiveFilename(index, selected.length, extension));
        this.dataLimit = storedZipDataLimit(filenames);
        this.preparedSize = [...prepared.values()].reduce((size, blob) => size + blob.size, 0);
        if (this.preparedSize > this.dataLimit)
            throw new ImageArchiveLimitError();
    }
    get remainingBytes() { return this.dataLimit - this.preparedSize; }
    retain(item, blob) {
        validatePreparedMedia(item, blob, this.format);
        if (blob.size > this.remainingBytes)
            throw new ImageArchiveLimitError();
        this.prepared.set(item, blob);
        this.preparedSize += blob.size;
    }
    entries() {
        const entries = createImageZipEntries(this.selected, this.prepared, this.format);
        const dataLimit = storedZipDataLimit(entries.map(entry => entry.filename));
        if (this.preparedSize > dataLimit)
            throw new ImageArchiveLimitError();
        return entries;
    }
}
