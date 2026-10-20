import type {WorkerMessageScope} from "../contracts/worker-contracts.js";
import {hasCompleteWebm} from "../../core/webm-structure.js";

const scope = self as unknown as WorkerMessageScope<boolean>;
scope.addEventListener("message", event => {
  scope.postMessage(event.data instanceof ArrayBuffer && hasCompleteWebm(new Uint8Array(event.data)));
});
