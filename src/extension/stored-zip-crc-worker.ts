import {storedZipChecksum} from "../core/stored-zip.js";

interface ChecksumRequest {
  readonly id: number;
  readonly blob: Blob;
}

interface ChecksumReply {
  readonly id: number;
  readonly checksum?: number;
  readonly error?: string;
}

const scope = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<ChecksumRequest>) => void): void;
  postMessage(message: ChecksumReply): void;
};

scope.addEventListener("message", event => {
  const {id, blob} = event.data;
  void storedZipChecksum(blob).then(value => {
    scope.postMessage({id, checksum: value});
  }).catch(error => {
    scope.postMessage({id, error: error instanceof Error ? error.message : "ZIPのCRC確認に失敗しました。"});
  });
});
