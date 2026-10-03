import assert from "node:assert/strict";
import test from "node:test";

const {loadExportPreferences, saveExportFormat, saveSourcePagePreference} = await import("../dist/extension/app/browser/export-preferences.js");
const {deriveExportViewState, exportFileBaseName, imageFilename, createSourcePreview, createExportPresentation} = await import("../dist/extension/app/panel/export-presentation.js");
const {createExportLifecycle} = await import("../dist/extension/app/panel/export-lifecycle.js");

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("export preferences use safe defaults and persist only supported choices", () => {
  assert.deepEqual(loadExportPreferences(memoryStorage()), {format: "pdf", includeSourcePage: false});
  assert.deepEqual(loadExportPreferences(memoryStorage([
    ["harvest.exportFormat", "jxl"],
    ["harvest.includeSourcePage", "true"],
  ])), {format: "jxl", includeSourcePage: true});
  assert.deepEqual(loadExportPreferences(memoryStorage([
    ["harvest.exportFormat", "unsupported"],
    ["harvest.includeSourcePage", "yes"],
  ])), {format: "pdf", includeSourcePage: false});

  const storage = memoryStorage();
  assert.equal(saveExportFormat("png", storage), true);
  assert.equal(saveSourcePagePreference(true, storage), true);
  assert.deepEqual(loadExportPreferences(storage), {format: "png", includeSourcePage: true});
  assert.equal(saveSourcePagePreference(false, storage), true);
  assert.equal(loadExportPreferences(storage).includeSourcePage, false);
});

test("MP4・GIFの保存設定を読み取り、旧設定の内容は書き換えない", () => {
  for (const format of ["mp4", "gif"]) {
    const storage = memoryStorage();
    assert.equal(saveExportFormat(format, storage), true);
    assert.equal(loadExportPreferences(storage).format, format);
  }
  const legacy = memoryStorage([["harvest.exportFormat", "original"]]);
  assert.equal(loadExportPreferences(legacy).format, "pdf");
  assert.equal(legacy.values.get("harvest.exportFormat"), "original");
});

test("unavailable preference storage falls back cleanly and reports writes that fail", () => {
  const unreadable = {getItem() { throw new Error("storage unavailable"); }, setItem() { throw new Error("storage unavailable"); } };
  assert.deepEqual(loadExportPreferences(unreadable), {format: "pdf", includeSourcePage: false});
  assert.equal(saveExportFormat("jxl", unreadable), false);
  assert.equal(saveSourcePagePreference(true, unreadable), false);
});

function pending(format, failed = new Map()) {
  return {format, selected: [image], prepared: new Map(), failed};
}

const image = {url: "https://example.test/image.png", sourcePage: "https://example.test/gallery"};
function viewState(overrides = {}) {
  return deriveExportViewState({
    format: "pdf",
    includeSourcePage: false,
    selected: [],
    completed: null,
    pdfPending: null,
    imagePending: null,
    pdfRunning: false,
    imageRunning: false,
    pdfProgress: "",
    imageProgress: "",
    ...overrides,
  });
}

test("export presentation follows empty, ready, running, retry, saved, and format compatibility states", () => {
  assert.equal(viewState().phase, "empty");
  assert.equal(viewState({selected: [image]}).phase, "ready");
  const pdfWork = pending(undefined, new Map([[image, "failed"]]));
  assert.deepEqual(viewState({selected: [image], pdfRunning: true, pdfProgress: "1 / 2", pdfPending: pdfWork}), {
    phase: "running", pending: pdfWork, progress: "1 / 2",
  });
  assert.deepEqual(viewState({selected: [image], pdfPending: pdfWork}), {phase: "retry-required", pending: pdfWork, progress: ""});
  assert.equal(viewState({selected: [image], completed: {format: "pdf", selected: [image], includeSourcePage: false}}).phase, "saved");
  const pdfCompleted = {format: "pdf", selected: [image], includeSourcePage: false};
  assert.equal(viewState({selected: [image], completed: pdfCompleted, includeSourcePage: true}).phase, "ready",
    "changing the source page setting after a PDF save requires another save");
  assert.equal(viewState({selected: [image], completed: {...pdfCompleted, includeSourcePage: true}, includeSourcePage: true}).phase, "saved",
    "a PDF is saved again when its current source page setting matches");
  assert.equal(viewState({format: "jpg", selected: [image], completed: {...pdfCompleted, format: "jpg"}, includeSourcePage: true}).phase, "saved",
    "source page setting does not affect image archive save state");
  assert.equal(viewState({selected: [image], completed: {format: "jpg", selected: [image]}}).phase, "ready");
  assert.equal(viewState({selected: [image], completed: {format: "pdf", selected: [{...image}]}}).phase, "ready",
    "a result is saved only while the same image objects remain selected in the same order");

  const pngWork = pending("png", new Map([[image, "failed"]]));
  assert.equal(viewState({format: "jpg", selected: [image], imagePending: pngWork}).phase, "ready",
    "pending image work for a different format must not block the selected format");
  assert.equal(viewState({format: "png", selected: [image], imagePending: pngWork}).phase, "retry-required");
});

test("file labels and source preview safely represent URLs and XML text", () => {
  assert.equal(imageFilename("https://example.test/files/a%20b%26c.png?size=2"), "a b&c.png");
  assert.equal(exportFileBaseName('A/B:C*D?E"F<G>H|I', "Harvest"), "A_B_C_D_E_F_G_H_I");
  assert.equal(exportFileBaseName("////", "Harvest"), "____");
  assert.equal(exportFileBaseName("x".repeat(120), "Harvest").length, 100);

  const preview = createSourcePreview([image], "pdf", true, "Source <&> \"'", "file<&>.pdf");
  assert.ok(preview);
  assert.equal(preview.sourcePage, image.sourcePage);
  assert.equal(preview.selected, true);
  const svg = decodeURIComponent(preview.url.slice(preview.url.indexOf(",") + 1));
  assert.match(svg, /Source &lt;&amp;&gt; &quot;&apos;/);
  assert.match(svg, /file&lt;&amp;&gt;\.pdf/);
  assert.match(svg, /https:\/\/example\.test\/gallery/);
  assert.equal(createSourcePreview([image], "jpg", true, "Source", "file.jpg"), null);
  assert.equal(createSourcePreview([image], "pdf", false, "Source", "file.pdf"), null);
  assert.equal(createSourcePreview([], "pdf", true, "Source", "file.pdf"), null);
});

test("出力名・画像一覧の出典・閲覧ページが同じ選択順序と形式を反映する", () => {
  let title = "Title / test";
  let selection = {format: "pdf", includeSourcePage: true, selected: [image, {...image, url: "https://example.test/second.png"}]};
  const presentation = createExportPresentation({
    getTitle: () => title,
    getSelection: () => selection,
    fallbackTitle: "Images",
    sourceHeading: "Source",
  });
  assert.equal(presentation.resultFilename, "Title _ test.pdf");
  assert.equal(presentation.pdfFilename, "Title _ test.pdf");
  assert.equal(presentation.zipFilename, "Title _ test.zip");
  assert.deepEqual(presentation.viewerPages.slice(0, 2), selection.selected);
  assert.equal(presentation.viewerPages.at(-1).url, presentation.sourcePreview.url);
  selection = {...selection, selected: [...selection.selected].reverse()};
  assert.equal(presentation.viewerPages[0], selection.selected[0]);
  assert.equal(presentation.viewerPages.at(-1).sourcePage, selection.selected[0].sourcePage);
  for (const format of ["jpg", "png", "jxl", "gif", "mp4"]) {
    selection = {...selection, format};
    assert.equal(presentation.sourcePreview, null, format);
    assert.deepEqual(presentation.viewerPages, selection.selected, format);
    assert.equal(presentation.resultFilename, format === "mp4" ? "Title _ test_001.mp4" : "Title _ test.zip", format);
    selection = {...selection, selected: [image]};
    assert.equal(presentation.resultFilename, `Title _ test.${format}`, format);
    selection = {...selection, selected: [image, {...image}]};
  }
  title = "...";
  selection = {...selection, format: "pdf", selected: []};
  assert.equal(presentation.resultFilename, "Images.pdf");
  assert.equal(presentation.sourcePreview, null);
  assert.deepEqual(presentation.viewerPages, []);
});

test("shared export lifecycle discards changed selections and cleans up aborted work", async () => {
  const statuses = [];
  const busyChanges = [];
  let scrolledToFailures = 0;
  let disposed = false;
  const lifecycle = createExportLifecycle({
    cancelledMessage: "Saving cancelled",
    isBusy: () => false,
    isDisposed: () => disposed,
    onBusyChange: value => busyChanges.push(value),
    onStatus: (...args) => statuses.push(args),
    onScrollToFailures: () => { scrolledToFailures += 1; },
  });
  const changedImage = {url: "https://example.test/changed.png"};
  const work = lifecycle.resolveWork([image], () => ({selected: [image], prepared: new Map(), failed: new Map()}));
  assert.equal(lifecycle.pending, work);
  assert.equal(lifecycle.discardIfSelectionChanged([image]), false);
  assert.equal(lifecycle.discardIfSelectionChanged([changedImage]), true);
  assert.equal(lifecycle.pending, null);

  const runWork = lifecycle.resolveWork([image], () => ({selected: [image], prepared: new Map(), failed: new Map()}));
  let runSignal;
  let stoppedAfterAbort = false;
  const execution = lifecycle.run(runWork, "Preparing", "0 / 1", async run => {
    runSignal = run.signal;
    runWork.prepared.set(image, new Blob(["prepared image"]));
    runWork.failed.set(changedImage, "failed image");
    await new Promise(resolve => runSignal.addEventListener("abort", resolve, {once: true}));
    stoppedAfterAbort = run.stopped;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lifecycle.isRunning, true);
  assert.equal(lifecycle.progress, "0 / 1");
  lifecycle.abort();
  await execution;
  assert.equal(runSignal.aborted, true);
  assert.equal(stoppedAfterAbort, true);
  assert.equal(lifecycle.pending, null, "cancelled work is discarded before another save");
  assert.equal(runWork.prepared.size, 0, "prepared image memory is released on cancellation");
  assert.equal(runWork.failed.size, 0, "cancelled failures do not turn the next save into a retry");
  assert.equal(statuses.at(-1)[1], "info", "cancellation is not reported as an error");
  assert.equal(lifecycle.isRunning, false);
  assert.equal(lifecycle.progress, "");
  assert.deepEqual(busyChanges, [true, false]);
  assert.deepEqual(statuses[0], ["Preparing", "busy", "0 / 1"]);
  assert.equal(scrolledToFailures, 0);
});

test("export lifecycle replaces incompatible pending work and scrolls to retained failures", async () => {
  let scrolledToFailures = 0;
  const lifecycle = createExportLifecycle({
    cancelledMessage: "Saving cancelled",
    isBusy: () => false,
    isDisposed: () => false,
    onBusyChange() {},
    onStatus() {},
    onScrollToFailures: () => { scrolledToFailures += 1; },
  });
  const first = lifecycle.resolveWork([image], () => ({format: "png", selected: [image], prepared: new Map(), failed: new Map()}));
  const replacement = lifecycle.resolveWork([image], () => ({format: "jpg", selected: [image], prepared: new Map(), failed: new Map()}), work => work.format === "jpg");
  assert.notEqual(replacement, first);
  assert.equal(lifecycle.pending, replacement);
  replacement.failed.set(image, "Could not prepare image");
  await lifecycle.run(replacement, "Retrying", "0 / 1", async run => {
    assert.equal(run.retry, true);
    run.reportStatus("Could not prepare image", "error");
  });
  assert.equal(lifecycle.pending, replacement);
  assert.equal(scrolledToFailures, 1);
});
