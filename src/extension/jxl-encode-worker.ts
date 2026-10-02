import type { JxlEncodeRequest, JxlEncodeReply, WorkerMessageScope } from "./worker-contracts.js";
import { encodeJxlPixels } from "./jxl-codec.js";

const scope = self as unknown as WorkerMessageScope<JxlEncodeRequest, JxlEncodeReply>;

scope.addEventListener("message", event => {
  const {id, pixels, width, height} = event.data;
  const image = {data: new Uint8ClampedArray(pixels), width, height} as ImageData;
  void encodeJxlPixels(image).then(buffer => {
    scope.postMessage({id, buffer}, [buffer]);
  }).catch(error => {
    scope.postMessage({id, error: error instanceof Error ? error.message : "JXLの変換に失敗しました。"});
  });
});
