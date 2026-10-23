import {readFile} from "node:fs/promises";
import decode, {init} from "@jsquash/jxl/decode.js";

// Test-only decoder from the existing dependency; never shipped as runtime code.
let ready;
export async function decodeJxl(bytes) {
  ready ??= readFile(new URL("../../node_modules/@jsquash/jxl/codec/dec/jxl_dec.wasm", import.meta.url))
    .then(wasmBinary => init({wasmBinary}));
  await ready;
  return decode(Uint8Array.from(bytes).buffer);
}
