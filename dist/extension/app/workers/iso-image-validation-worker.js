import { hasCompleteIsoImage } from "../../core/original-isobmff-image.js";
const scope = self;
scope.addEventListener("message", event => {
    scope.postMessage(event.data instanceof ArrayBuffer && hasCompleteIsoImage(new Uint8Array(event.data)));
});
