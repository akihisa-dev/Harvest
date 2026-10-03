import {mkdtemp, rm} from "node:fs/promises";
import {createServer} from "node:http";
import {chromium} from "playwright";
import {resourcesFor} from "./resources.mjs";

export async function temporaryDirectory(t, prefix) {
  return resourcesFor(t).acquire(() => mkdtemp(prefix), directory => rm(directory, {recursive: true, force: true}));
}

export async function launchBrowser(t, options = {}) {
  return resourcesFor(t).acquire(
    () => chromium.launch({channel: "chrome", headless: true, ...options}), browser => browser.close());
}

export async function launchExtensionContext(t, profile, options = {}) {
  return resourcesFor(t).acquire(() => chromium.launchPersistentContext(profile, {
    channel: "chrome", headless: true, ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging", "--disable-background-networking", "--no-first-run"],
    ...options,
  }), context => context.close());
}

export async function startServer(t, handler) {
  const server = createServer(handler);
  resourcesFor(t).defer(() => new Promise((resolve, reject) => {
    server.close(error => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  return server;
}
