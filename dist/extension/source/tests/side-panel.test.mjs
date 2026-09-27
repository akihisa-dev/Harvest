import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import test from "node:test";

test("ツールバーのアイコンはポップアップを出さずにサイドパネルを開く", async () => {
  const manifest = JSON.parse(await readFile(new URL("../dist/extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, "app/index.html");
  assert.ok(manifest.permissions.includes("sidePanel"));

  const background = await readFile(new URL("../dist/extension/background.js", import.meta.url), "utf8");
  const behavior = [];
  runInNewContext(background, {chrome: {sidePanel: {setPanelBehavior: value => {
    behavior.push(value);
    return Promise.resolve();
  }}}});
  assert.equal(behavior.length, 1);
  assert.equal(behavior[0].openPanelOnActionClick, true);
});
