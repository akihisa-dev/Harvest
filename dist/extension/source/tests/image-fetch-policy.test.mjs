import assert from "node:assert/strict";
import test from "node:test";
import {getImageFetchCredentials, ImageFetchTargetError, validateImageFetchTarget} from "../dist/extension/app/media/image-fetch-policy.js";

test("ログイン状態は出典と完全一致するHTTPオリジンだけで使う", () => {
  assert.equal(getImageFetchCredentials("https://Reader.example:443/pages/1.jpg", "https://reader.example/book"), "include");
  assert.equal(getImageFetchCredentials("https://cdn.example/pages/1.jpg", "https://reader.example/book"), "omit");
  assert.equal(getImageFetchCredentials("http://reader.example/pages/1.jpg", "https://reader.example/book"), "omit");
  assert.equal(getImageFetchCredentials("https://reader.example:8443/pages/1.jpg", "https://reader.example/book"), "omit");
  assert.equal(getImageFetchCredentials("data:image/svg+xml,local", "https://reader.example/book"), "omit");
  assert.equal(getImageFetchCredentials("https://reader.example/pages/1.jpg", undefined), "omit");
});

test("別オリジンのローカル・プライベート宛と資格情報入りURLを拒否する", () => {
  const source = "https://reader.example/book";
  const blocked = [
    "http://localhost/image.png",
    "http://sub.localhost/image.png",
    "http://printer.local/image.png",
    "http://127.0.0.1/image.png",
    "http://10.0.0.1/image.png",
    "http://172.31.255.254/image.png",
    "http://192.168.1.1/image.png",
    "http://169.254.169.254/latest/image.png",
    "http://100.64.0.1/image.png",
    "http://[::1]/image.png",
    "http://[fc00::1]/image.png",
    "http://[fe80::1]/image.png",
    "http://[::ffff:192.168.1.1]/image.png",
    "https://user:pass@cdn.example/image.png",
  ];
  for (const url of blocked) assert.throws(() => validateImageFetchTarget(url, source), ImageFetchTargetError, url);
  assert.doesNotThrow(() => validateImageFetchTarget("http://localhost/image.png", "http://localhost/book"));
  assert.doesNotThrow(() => validateImageFetchTarget("https://cdn.example/image.png", source));
  assert.throws(() => validateImageFetchTarget("file:///etc/passwd", source), ImageFetchTargetError);
});
