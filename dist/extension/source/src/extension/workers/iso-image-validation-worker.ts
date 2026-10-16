import type {WorkerMessageScope} from "../contracts/worker-contracts.js";
import {hasCompleteIsoImage} from "../../core/original-isobmff-image.js";

const scope = self as unknown as WorkerMessageScope<boolean>;
scope.addEventListener("message", event => {
  scope.postMessage(event.data instanceof ArrayBuffer && hasCompleteIsoImage(new Uint8Array(event.data)));
});
