export class ImageArchiveLimitError extends RangeError {
    constructor() {
        super("ZIP全体がZIP形式の上限を超えています。");
    }
}
