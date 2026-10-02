import type { ZipChecksumRequest, ZipChecksumReply, WorkerMessageScope } from "./worker-contracts.js";
import {storedZipChecksum} from "../core/stored-zip.js";

const scope = self as unknown as WorkerMessageScope<ZipChecksumRequest, ZipChecksumReply>;

scope.addEventListener("message", event => {
  const {id, blob} = event.data;
  void storedZipChecksum(blob).then(value => {
    scope.postMessage({id, checksum: value});
  }).catch(error => {
    scope.postMessage({id, error: error instanceof Error ? error.message : "ZIPのCRC確認に失敗しました。"});
  });
});
