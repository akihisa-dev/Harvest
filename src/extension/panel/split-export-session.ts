import type {ImageItem} from "../../core/images.js";
import type {ExportFormat} from "../../core/export-formats.js";
import {isImageExportFormat, splitSettingsMatch, type SplitExportSettings, type VideoExportFormat} from "../../core/split-export-formats.js";
import type {ExportSessionState} from "./export-session.js";
import type {createMixedExportController} from "./mixed-export-controller.js";
import {selectionsMatch} from "./export-lifecycle.js";

type Controller = ReturnType<typeof createMixedExportController>;
interface Options extends SplitExportSettings {
  readonly getSelectedItems: () => readonly ImageItem[];
  readonly getController: () => Controller | null;
  readonly isBusy: () => boolean;
}
interface Snapshot extends SplitExportSettings {readonly selected: readonly ImageItem[];}
/** One request snapshot owns both media choices, selection order, cancellation and completion. */
export function createSplitExportSession(options: Options) {
  let settings: SplitExportSettings = {imageFormat:options.imageFormat,videoFormat:options.videoFormat,includeSourcePage:options.includeSourcePage};
  let completed: Snapshot | null = null;
  let active: {readonly snapshot: Snapshot; readonly abort: () => void; acceptsCompletion: boolean} | null = null;
  function invalidateCompletion(): void {completed=null;if (active) active.acceptsCompletion=false;}
  function update(next: SplitExportSettings): void {
    if (splitSettingsMatch(settings,next)) return;
    settings=next;invalidateCompletion();
    if (!options.getController()?.isRunning) options.getController()?.clear();
  }
  return {
    get format() {return settings.imageFormat;},
    get videoFormat() {return settings.videoFormat;},
    get includeSourcePage() {return settings.includeSourcePage;},
    get selectedItems() {return options.getSelectedItems();},
    get state(): ExportSessionState & {readonly videoFormat: VideoExportFormat} {
      const selected=options.getSelectedItems(),controller=options.getController(),pending=controller?.pending??null;
      const saved=completed!==null&&splitSettingsMatch(settings,completed)&&selectionsMatch(selected,completed.selected);
      const view: ExportSessionState["view"] = controller?.isRunning ? {phase:"running",pending,progress:controller.progress}
        : pending?.failed.size ? {phase:"retry-required",pending,progress:""}
        : saved ? {phase:"saved",pending:null,progress:""}
        : {phase:selected.length ? "ready" : "empty",pending:null,progress:""};
      return {format:settings.imageFormat,videoFormat:settings.videoFormat,includeSourcePage:settings.includeSourcePage,selected,view};
    },
    setFormat(format: ExportFormat): void {
      if (!isImageExportFormat(format)) throw new Error("画像の保存形式が不正です。");
      update({...settings,imageFormat:format});
    },
    setVideoFormat(videoFormat: VideoExportFormat): void {update({...settings,videoFormat});},
    setIncludeSourcePage(includeSourcePage: boolean): void {update({...settings,includeSourcePage});},
    invalidateCompletion,
    selectionChanged(): boolean {
      const selected=options.getSelectedItems();
      const changed=options.getController()?.discardIfSelectionChanged(selected)??false;
      const completionChanged=completed!==null&&!selectionsMatch(completed.selected,selected);
      if (changed||completionChanged) invalidateCompletion();
      if (active&&!selectionsMatch(active.snapshot.selected,selected)) active.acceptsCompletion=false;
      return changed||completionChanged;
    },
    clear(): void {invalidateCompletion();options.getController()?.clear();},
    complete(): void {if (active?.acceptsCompletion) completed=active.snapshot;},
    abort(): void {if (active) {active.acceptsCompletion=false;active.abort();}},
    async start(): Promise<void> {
      if (options.isBusy()||active) return;
      const selected=[...options.getSelectedItems()],controller=options.getController();
      if (!selected.length||!controller) return;
      const snapshot={...settings,selected},request={snapshot,abort:()=>controller.abort(),acceptsCompletion:true};
      completed=null;active=request;
      try {await controller.export(snapshot);} finally {if (active===request) active=null;}
    },
  };
}
