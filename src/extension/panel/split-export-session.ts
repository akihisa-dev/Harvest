import type {ImageItem} from "../../core/images.js";
import {isImageExportFormat, splitSettingsMatch, type SplitExportSettings, type ImageExportFormat, type VideoExportFormat} from "../../core/split-export-formats.js";
import type {ExportViewState} from "./export-presentation.js";
import type {createMixedExportController} from "./mixed-export-controller.js";
import {selectionsMatch} from "./export-lifecycle.js";
import {imageRecommendations, resolveImageExportFormat, type ImageRecommendation, type ResolvedImageExportFormat} from "../../core/export-recommendations.js";

export interface ExportSessionState {
  readonly format: ImageExportFormat;
  readonly resolvedImageFormat: ResolvedImageExportFormat;
  readonly videoFormat: VideoExportFormat;
  readonly includeSourcePage: boolean;
  readonly selected: readonly ImageItem[];
  readonly view: ExportViewState;
}

export interface ExportRenderState extends ExportSessionState {
  readonly recommendations: readonly ImageRecommendation[];
  readonly recommendedImageFormat: ResolvedImageExportFormat;
}

type Controller = ReturnType<typeof createMixedExportController>;
interface Options extends SplitExportSettings {
  readonly getSelectedItems: () => readonly ImageItem[];
  readonly getController: () => Controller | null;
  readonly isBusy: () => boolean;
}
interface Snapshot extends SplitExportSettings {
  readonly selected: readonly ImageItem[];
  readonly resolvedImageFormat: ResolvedImageExportFormat;
}
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
  function resolvedFormat(selected = options.getSelectedItems(), recommendations?: readonly ImageRecommendation[]): ResolvedImageExportFormat {
    const controller = options.getController();
    const snapshots = [controller?.isRunning ? active?.snapshot : undefined, completed, controller?.pending];
    for (const snapshot of snapshots) {
      if (snapshot && splitSettingsMatch(settings, snapshot) && selectionsMatch(selected, snapshot.selected)) {
        return snapshot.resolvedImageFormat;
      }
    }
    return resolveImageExportFormat(settings.imageFormat, selected, recommendations);
  }
  function readState(selected: readonly ImageItem[], recommendations?: readonly ImageRecommendation[]): ExportSessionState {
    const controller=options.getController(),pending=controller?.pending??null;
    const saved=completed!==null&&splitSettingsMatch(settings,completed)&&selectionsMatch(selected,completed.selected);
    const view: ExportSessionState["view"] = controller?.isRunning ? {phase:"running",pending,progress:controller.progress}
      : pending?.failed.size ? {phase:"retry-required",pending,progress:""}
      : saved ? {phase:"saved",pending:null,progress:""}
      : {phase:selected.length ? "ready" : "empty",pending:null,progress:""};
    return {format:settings.imageFormat,resolvedImageFormat:resolvedFormat(selected,recommendations),videoFormat:settings.videoFormat,includeSourcePage:settings.includeSourcePage,selected,view};
  }
  return {
    get format() {return settings.imageFormat;},
    get resolvedImageFormat() {return resolvedFormat();},
    get videoFormat() {return settings.videoFormat;},
    get includeSourcePage() {return settings.includeSourcePage;},
    get selectedItems() {return options.getSelectedItems();},
    get state(): ExportSessionState {return readState(options.getSelectedItems());},
    get renderState(): ExportRenderState {
      const selected=options.getSelectedItems(),recommendations=imageRecommendations(selected);
      return {...readState(selected,recommendations),recommendations,
        recommendedImageFormat:resolveImageExportFormat("recommend",selected,recommendations)};
    },
    setFormat(format: ImageExportFormat): void {
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
      const snapshot={...settings,selected,resolvedImageFormat:resolvedFormat(selected)},request={snapshot,abort:()=>controller.abort(),acceptsCompletion:true};
      completed=null;active=request;
      try {await controller.export(snapshot);} finally {if (active===request) active=null;}
    },
  };
}
