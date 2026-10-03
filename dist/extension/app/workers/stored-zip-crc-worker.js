import { isZipChecksumRequest } from "../contracts/worker-contracts.js";
import { storedZipChecksum } from "../../core/stored-zip.js";
const scope = self;
scope.addEventListener("message", event => {
    if (!isZipChecksumRequest(event.data))
        throw new Error("Workerへの要求が不正です。");
    const { id, blob } = event.data;
    void storedZipChecksum(blob).then(value => {
        scope.postMessage({ id, checksum: value });
    }).catch(error => {
        scope.postMessage({ id, error: error instanceof Error ? error.message : "ZIPのCRC確認に失敗しました。" });
    });
});
