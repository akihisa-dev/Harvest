import { encodeJxlPixels } from "./jxl-codec.js";

interface EncodeRequest {
  readonly id: number;
  readonly pixels: ArrayBuffer;
  readonly width: number;
  readonly height: number;
}

interface EncodeReply {
  readonly id: number;
  readonly buffer?: ArrayBuffer;
  readonly error?: string;
}

const scope = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<EncodeRequest>) => void): void;
  postMessage(message: EncodeReply, transfer?: Transferable[]): void;
};

scope.addEventListener("message", event => {
  const {id, pixels, width, height} = event.data;
  const image = {data: new Uint8ClampedArray(pixels), width, height} as ImageData;
  void encodeJxlPixels(image).then(buffer => {
    scope.postMessage({id, buffer}, [buffer]);
  }).catch(error => {
    scope.postMessage({id, error: error instanceof Error ? error.message : "JXLの変換に失敗しました。"});
  });
});
