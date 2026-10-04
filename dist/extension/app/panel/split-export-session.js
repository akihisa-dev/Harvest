import { isImageExportFormat, splitSettingsMatch } from "../../core/split-export-formats.js";
import { selectionsMatch } from "./export-lifecycle.js";
import { resolveImageExportFormat } from "../../core/export-recommendations.js";
/** One request snapshot owns both media choices, selection order, cancellation and completion. */
export function createSplitExportSession(options) {
    let settings = { imageFormat: options.imageFormat, videoFormat: options.videoFormat, includeSourcePage: options.includeSourcePage };
    let completed = null;
    let active = null;
    function invalidateCompletion() { completed = null; if (active)
        active.acceptsCompletion = false; }
    function update(next) {
        if (splitSettingsMatch(settings, next))
            return;
        settings = next;
        invalidateCompletion();
        if (!options.getController()?.isRunning)
            options.getController()?.clear();
    }
    function resolvedFormat() {
        const selected = options.getSelectedItems();
        const controller = options.getController();
        const snapshots = [controller?.isRunning ? active?.snapshot : undefined, completed, controller?.pending];
        for (const snapshot of snapshots) {
            if (snapshot && splitSettingsMatch(settings, snapshot) && selectionsMatch(selected, snapshot.selected)) {
                return snapshot.resolvedImageFormat;
            }
        }
        return resolveImageExportFormat(settings.imageFormat, selected);
    }
    return {
        get format() { return settings.imageFormat; },
        get resolvedImageFormat() { return resolvedFormat(); },
        get videoFormat() { return settings.videoFormat; },
        get includeSourcePage() { return settings.includeSourcePage; },
        get selectedItems() { return options.getSelectedItems(); },
        get state() {
            const selected = options.getSelectedItems(), controller = options.getController(), pending = controller?.pending ?? null;
            const saved = completed !== null && splitSettingsMatch(settings, completed) && selectionsMatch(selected, completed.selected);
            const view = controller?.isRunning ? { phase: "running", pending, progress: controller.progress }
                : pending?.failed.size ? { phase: "retry-required", pending, progress: "" }
                    : saved ? { phase: "saved", pending: null, progress: "" }
                        : { phase: selected.length ? "ready" : "empty", pending: null, progress: "" };
            return { format: settings.imageFormat, resolvedImageFormat: resolvedFormat(), videoFormat: settings.videoFormat, includeSourcePage: settings.includeSourcePage, selected, view };
        },
        setFormat(format) {
            if (!isImageExportFormat(format))
                throw new Error("画像の保存形式が不正です。");
            update({ ...settings, imageFormat: format });
        },
        setVideoFormat(videoFormat) { update({ ...settings, videoFormat }); },
        setIncludeSourcePage(includeSourcePage) { update({ ...settings, includeSourcePage }); },
        invalidateCompletion,
        selectionChanged() {
            const selected = options.getSelectedItems();
            const changed = options.getController()?.discardIfSelectionChanged(selected) ?? false;
            const completionChanged = completed !== null && !selectionsMatch(completed.selected, selected);
            if (changed || completionChanged)
                invalidateCompletion();
            if (active && !selectionsMatch(active.snapshot.selected, selected))
                active.acceptsCompletion = false;
            return changed || completionChanged;
        },
        clear() { invalidateCompletion(); options.getController()?.clear(); },
        complete() { if (active?.acceptsCompletion)
            completed = active.snapshot; },
        abort() { if (active) {
            active.acceptsCompletion = false;
            active.abort();
        } },
        async start() {
            if (options.isBusy() || active)
                return;
            const selected = [...options.getSelectedItems()], controller = options.getController();
            if (!selected.length || !controller)
                return;
            const snapshot = { ...settings, selected, resolvedImageFormat: resolvedFormat() }, request = { snapshot, abort: () => controller.abort(), acceptsCompletion: true };
            completed = null;
            active = request;
            try {
                await controller.export(snapshot);
            }
            finally {
                if (active === request)
                    active = null;
            }
        },
    };
}
