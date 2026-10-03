import assert from "node:assert/strict";
import {access, mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import {launchBrowser, startServer, temporaryDirectory} from "./support/browser.mjs";
import {resourcesFor} from "./support/resources.mjs";
import {extensionFile, serveExtension} from "./support/extension-files.mjs";

test("Chrome setup failure releases an already listening server and its temporary files", async t => {
  const directory = await temporaryDirectory(t, join(tmpdir(), "harvest-harness-"));
  const server = await startServer(t, (_request, response) => response.end("fixture"));
  await assert.rejects(launchBrowser(t, {executablePath: join(directory, "missing-browser")}));
  await resourcesFor(t).close();
  assert.equal(server.listening, false);
  await assert.rejects(access(directory), {code: "ENOENT"});
});

test("shared fixture serving uses correct module MIME types and confines paths to its root", async t => {
  const root = await temporaryDirectory(t, join(tmpdir(), "harvest-fixture-server-"));
  await mkdir(join(root, "app"));
  await writeFile(join(root, "app/index.js"), "export const fixture = true;");
  const {origin} = await serveExtension(t, {root});
  const response = await fetch(`${origin}/app/index.js`);
  assert.equal(response.headers.get("content-type"), "text/javascript");
  assert.equal(await response.text(), "export const fixture = true;");
  assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
  await assert.rejects(extensionFile("/%2e%2e/outside.js", root), /Outside extension root/);
});
