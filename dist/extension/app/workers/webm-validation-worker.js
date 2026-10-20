import { hasCompleteWebm } from "../../core/webm-structure.js";
const scope = self;
scope.addEventListener("message", event => {
    scope.postMessage(event.data instanceof ArrayBuffer && hasCompleteWebm(new Uint8Array(event.data)));
});
