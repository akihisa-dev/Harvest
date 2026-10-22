import test from "node:test";
import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {launchExtensionContext, temporaryDirectory} from "./support/browser.mjs";
import {extensionVersionParts} from "../scripts/lib/extension-version.mjs";

test("版番号のChrome読込条件とHarvestの3整数規則を区別して確認する", async t => {
  const root = await temporaryDirectory(t, join(tmpdir(), "harvest-version-chrome-"));
  const context = await launchExtensionContext(t, join(root, "profile"));
  const cdp = await context.browser().newBrowserCDPSession();
  const versions = ["1.7.37", "65535.65535.65535", "1.7.38-beta.1", "1.7.38+build.1", "0.0.0", "01.2.3", "1.2", "1.2.3.4", "65536.0.0"];
  for (const [index, version] of versions.entries()) {
    const path = join(root, String(index));
    await mkdir(path);
    await writeFile(join(path, "manifest.json"), JSON.stringify({manifest_version: 3, name: "Harvest version fixture", version}));
    let accepted = false;
    try { await cdp.send("Extensions.loadUnpacked", {path}); accepted = true; }
    catch (error) { assert.match(error.message, /version.*(?:invalid|missing)/i); }
    t.diagnostic(JSON.stringify({version, chrome: accepted, harvest: !!extensionVersionParts(version)}));
    if (["1.7.37", "65535.65535.65535", "1.2", "1.2.3.4"].includes(version)) assert.equal(accepted, true);
    else if (version.includes("-") || version.includes("+")) assert.equal(accepted, false);
    // Harvest fixes three components and the documented 65535 ceiling even
    // when a Chrome version accepts a broader range at load time.
    if (extensionVersionParts(version)) assert.equal(accepted, true);
  }
});
