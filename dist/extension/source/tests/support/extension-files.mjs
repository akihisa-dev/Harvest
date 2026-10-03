import {readFile} from "node:fs/promises";
import {extname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {startServer} from "./browser.mjs";

export const extensionRoot = resolve(process.env.HARVEST_TEST_EXTENSION_DIR
  ?? fileURLToPath(new URL("../../dist/extension/", import.meta.url)));
const mimeTypes = {
  ".css": "text/css", ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".wasm": "application/wasm",
  ".png": "image/png",
};

export async function extensionFile(pathname, root = extensionRoot) {
  const path = resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("Outside extension root");
  return {body: await readFile(path), contentType: mimeTypes[extname(path)] ?? "application/octet-stream"};
}

export async function serveExtension(t, {headers = {}, root = extensionRoot} = {}) {
  const server = await startServer(t, async (request, response) => {
    try {
      const file = await extensionFile(new URL(request.url, "http://localhost").pathname, root);
      response.writeHead(200, {"content-type": file.contentType, ...headers});
      response.end(file.body);
    } catch { response.writeHead(404).end("Not found"); }
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {server, origin, url: `${origin}/app/index.html`};
}
