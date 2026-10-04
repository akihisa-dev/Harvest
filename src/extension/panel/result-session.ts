import { initialExportFormat, type ExportFormat } from "../../core/export-formats.js";
import type { ImageCollection } from "../../core/image-collection.js";
import type { ImagePreviewLoader } from "../media/image-preview.js";
import type { createExportSession } from "./export-session.js";
import type { ImageListView } from "./image-list-view.js";
import type { createSourceInputController } from "./source-input-controller.js";
import type { ViewerController } from "./viewer-controller.js";

interface ResultSessionOptions {
  readonly collection: ImageCollection;
  readonly exportSession: ReturnType<typeof createExportSession>;
  readonly sourceInput: Pick<ReturnType<typeof createSourceInputController>, "commitResult" | "reset">;
  readonly imageList: Pick<ImageListView, "clearVideoSizes" | "showInitialGroup" | "clearVisibleGroups">;
  readonly viewer: Pick<ViewerController, "setOpen" | "clearCurrentPage">;
  readonly previews: Pick<ImagePreviewLoader, "clear">;
  readonly getPreferredFormat: () => ExportFormat;
  readonly preserveFormat?: boolean;
  readonly clearAnalyzedUrl: () => void;
  readonly resetScan: () => void;
  readonly fallbackTitle: string;
}

/** Owns the title and dependent UI state of the current scan result as one lifetime. */
export function createResultSession(options: ResultSessionOptions) {
  let title = options.fallbackTitle;

  function resetViewer(): void {
    options.viewer.setOpen(false);
    options.viewer.clearCurrentPage();
  }

  return {
    get title() { return title; },
    commit(nextTitle: string, initialGroup: string | null, sourcePage: string): void {
      // The scan owns atomic collection replacement; dependent state follows only a successful result.
      if (!options.preserveFormat) options.exportSession.setFormat(initialExportFormat(options.collection.items, options.getPreferredFormat()));
      title = nextTitle;
      options.sourceInput.commitResult(sourcePage);
      options.previews.clear();
      options.imageList.clearVideoSizes();
      options.exportSession.clear();
      options.imageList.showInitialGroup(initialGroup);
      resetViewer();
    },
    reset(): void {
      options.previews.clear();
      options.sourceInput.reset();
      options.clearAnalyzedUrl();
      options.collection.clear();
      options.exportSession.clear();
      options.imageList.clearVisibleGroups();
      resetViewer();
      options.resetScan();
      title = options.fallbackTitle;
    },
  };
}
