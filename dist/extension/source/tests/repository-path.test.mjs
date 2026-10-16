import assert from "node:assert/strict";
import test from "node:test";
import {repositoryPathsMatch} from "../scripts/lib/repository-path.mjs";

test("Gitルート照合はWindowsの区切り・末尾・空白を正規化する", () => {
  for (const name of ["Harvest", "Harvest project"]) {
    assert.ok(repositoryPathsMatch(`C:\\work\\${name}\\`, `C:/work/${name}`, "win32"));
    assert.ok(repositoryPathsMatch(`C:/work/${name}/`, `c:/work/${name}`, "win32"));
    assert.ok(!repositoryPathsMatch(`C:/work/${name}`, `C:/other/${name}`, "win32"));
  }
  assert.ok(repositoryPathsMatch("/work/Harvest/", "/work/Harvest", "darwin"));
  assert.ok(!repositoryPathsMatch("/work/Harvest", "/other/Harvest", "darwin"));
});
