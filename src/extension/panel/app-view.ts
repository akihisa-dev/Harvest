import { isMediaArchiveFormat, originalItemExtension } from "../../core/export-formats.js";
import {isImageExportFormat, isStillImage} from "../../core/split-export-formats.js";
import {imageRecommendations, videoRecommendations, resolveImageExportFormat} from "../../core/export-recommendations.js";
import type { ImageItem } from "../../core/images.js";
import type { AppElements } from "./app-elements.js";
import { setButtonLabel } from "./button-state.js";
import { createEmptyStateView } from "./empty-state.js";
import { imageFilename } from "./export-presentation.js";
import type { ExportSessionState } from "./export-session.js";
import { formatPlural, localizeErrorMessage, t } from "./localization.js";
import { setMotionText } from "./motion.js";
import type { ScanState } from "./scan-session-controller.js";

export interface AppStatus {
  readonly message: string;
  readonly state: "info" | "busy" | "success" | "error";
  readonly progress: string;
}

interface ExportControlsState {
  readonly export: ExportSessionState;
  readonly busy: boolean;
  readonly status: AppStatus;
}

export interface AppViewState extends ExportControlsState {
  readonly items: readonly ImageItem[];
  readonly selectedCount: number;
  readonly initialOrderAndSelection: boolean;
  readonly scanState: ScanState;
  readonly scanRunning: boolean;
}

function exportButtonLabel(state: ExportSessionState): string {
  const {format, selected, view} = state;
  if (state.videoFormat !== undefined) {
    if (view.phase === "running") return view.progress;
    if (view.phase === "retry-required") return t("exportRetry");
    if (!selected.length) return t("save");
    return t(view.phase === "saved" ? "exportFilesSaved" : "exportSelectionAction",{count:selected.length,plural:formatPlural(selected.length)});
  }
  if (view.phase === "running") return view.progress;
  if (view.phase === "retry-required") return t("exportRetry");
  if (view.phase === "saved") {
    return t(isMediaArchiveFormat(format) ? "exportFilesSaved" : "exportSaved", {
      count: selected.length,
      plural: formatPlural(selected.length),
    });
  }
  if (!selected.length) return t("save");
  if (format === "original") return t("exportOriginalAction");
  if (format === "recommend") return t("exportRecommendAction");
  return t("exportAction", {format: format.toUpperCase()});
}

function renderExtensions(element: HTMLElement, extensions: readonly (string | null)[]): void {
  const values = [...new Set(extensions.map(value => value ?? t("exportUnknownFormat")))];
  const label = values.length > 1 ? t("exportMixedFormats") : values[0] ?? "—";
  element.textContent = `(${label})`;
  element.title = values.join(" / ");
}

function renderRecommendations(
  choices: readonly {readonly format: string; readonly input: HTMLInputElement}[],
  recommendations: readonly {readonly format: string; readonly reason: "preserve" | "series" | "playback"}[],
): string[] {
  const reasons = recommendations.map(({format, reason}) => ({format, text: t(
    reason === "series" ? "recommendationSeries" : reason === "playback" ? "recommendationPlayback" : "recommendationPreserve",
  )}));
  for (const {format, input} of choices) {
    const reason = reasons.find(candidate => candidate.format === format);
    const description = reason ? t("recommendation", {reason: reason.text}) : "";
    const label = input.closest?.("label");
    if (label) {label.dataset["recommended"] = String(Boolean(reason)); label.title = description;}
    if (description) input.setAttribute("aria-description", description);
    else input.removeAttribute("aria-description");
  }
  return reasons.map(reason => reason.text);
}

/** Displays snapshots; changing export work and notifying the page belong to application events. */
export function createAppView(elements: AppElements, positionOf: (item: ImageItem) => number | undefined) {
  const {
    sourceDrop, sourceUrl, scanButton, resetButton, exportButton, exportFormatInputs,
    includeSourcePage, sourcePageOption, exportMediaHint, statusElement, failuresElement,
    failedImagesElement, scanOverlay, exportOverlay, emptyElement, emptyLogoElement,
    emptyMessageElement, allSelectionCheckbox, resetOrderButton,
  } = elements;
  const updateEmptyState = createEmptyStateView({container: emptyElement, logo: emptyLogoElement, message: emptyMessageElement});

  function renderProgress(snapshot: ExportControlsState): void {
    const {selected, view} = snapshot.export;
    const status = snapshot.status;
    const success = status.state === "success";
    setMotionText(statusElement, success ? "" : status.state === "busy" ? status.progress : status.message);
    statusElement.setAttribute("aria-label", status.state === "busy" ? status.message : "");
    statusElement.dataset["state"] = status.state;
    statusElement.dataset["scanProgress"] = String(snapshot.busy && view.phase !== "running" && status.state === "busy" && Boolean(status.progress));
    statusElement.title = success ? "" : status.message;

    const running = view.phase === "running";
    exportButton.dataset["saving"] = String(running);
    exportButton.dataset["saved"] = String(view.phase === "saved");
    if (running && status.state === "busy") {
      exportButton.setAttribute("aria-label", `${status.message} ${t("exportCancelHint")}`);
    } else if (!running) exportButton.removeAttribute("aria-label");
    setButtonLabel(exportButton, exportButtonLabel(snapshot.export));
    exportButton.title = running ? `${view.progress} — ${t("exportCancelHint")}` : exportButton.textContent;
    exportButton.disabled = (snapshot.busy && !running) || !selected.length;
  }

  function renderFailures({format, view}: ExportSessionState): void {
    const pending = view.pending;
    failuresElement.hidden = !pending?.failed.size;
    failedImagesElement.replaceChildren(...(pending?.selected.filter(item => pending.failed.has(item)) ?? []).map(item => {
      const row = document.createElement("li");
      const fallback = format === "pdf" ? "errorPdfFetch" : isMediaArchiveFormat(format) ? "errorFileSave" : "errorImageConvert";
      row.textContent = t("failedRow", {
        index: positionOf(item)! + 1,
        filename: imageFilename(item.url),
        reason: localizeErrorMessage(pending!.failed.get(item) ?? t(fallback), fallback, true),
      });
      row.title = item.url;
      return row;
    }));
  }

  function render(snapshot: AppViewState): void {
    const {busy, items, selectedCount, scanState, scanRunning} = snapshot;
    const {format, selected, includeSourcePage: sourceIncluded, view} = snapshot.export;
    const selectedItems = items.filter(item => item.selected);
    const images=selectedItems.filter(item=>item.kind !== "video"),videos=selectedItems.filter(item=>item.kind === "video");
    const outputFormat = snapshot.export.resolvedImageFormat ?? (isImageExportFormat(format) ? resolveImageExportFormat(format, selectedItems) : format);
    const recommendedFormat = format === "recommend" ? outputFormat : resolveImageExportFormat("recommend", selectedItems);
    const reasons = [...new Set([
      ...renderRecommendations(exportFormatInputs, imageRecommendations(selectedItems)),
      ...renderRecommendations(elements.videoExportFormatInputs, videoRecommendations(selectedItems)),
    ])];
    renderExtensions(elements.exportOriginalExtension, images.map(originalItemExtension));
    renderExtensions(elements.videoOriginalExtension,videos.map(originalItemExtension));
    renderExtensions(elements.exportRecommendExtension, images.map(item => recommendedFormat === "original"
      ? originalItemExtension(item) : isStillImage(item) ? "PDF" : "GIF"));
    elements.imageFormatGroup.hidden = items.length > 0 && !items.some(item=>item.kind !== "video");
    elements.videoFormatGroup.hidden = !items.some(item=>item.kind === "video");
    exportMediaHint.textContent = [
      reasons.length ? `★ ${t("recommendation", {reason: reasons.join(" / ")})}` : "",
      outputFormat !== "original" && images.length ? t("movingImagesGif") : "",
      snapshot.export.videoFormat !== "original" && videos.length ? t("videoConversionHint") : "",
    ].filter(Boolean).join(" ");
    exportMediaHint.hidden = !exportMediaHint.textContent;
    exportMediaHint.title = exportMediaHint.textContent;
    scanButton.disabled = busy && !scanRunning;
    sourceDrop.disabled = busy;
    sourceUrl.disabled = busy;
    resetButton.disabled = busy;
    includeSourcePage.disabled = busy;
    includeSourcePage.checked = sourceIncluded;
    for (const choice of exportFormatInputs) {
      const hidden = false;
      const label = choice.input.closest?.("label");
      if (label) (label as HTMLElement).hidden = hidden;
      choice.input.disabled = busy || hidden;
      choice.input.checked = choice.format === format;
    }
    for (const choice of elements.videoExportFormatInputs) {choice.input.disabled=busy;choice.input.checked=choice.format === snapshot.export.videoFormat;}
    sourcePageOption.hidden = outputFormat !== "pdf" || (items.length>0 && !items.some(isStillImage));
    scanButton.dataset["scanning"] = String(scanRunning);
    setButtonLabel(scanButton, t(scanRunning ? "scanStop" : "scan"));
    if (scanRunning) scanButton.setAttribute("aria-label", t("scanStop"));
    else scanButton.removeAttribute("aria-label");
    renderProgress(snapshot);

    renderFailures(snapshot.export);
    scanOverlay.hidden = scanState !== "scanning";
    exportOverlay.hidden = view.phase !== "running";
    emptyElement.hidden = items.length > 0;
    const emptyMessage = scanState === "empty" ? t("scanEmpty") : scanState === "error" ? t("scanErrorEmpty") : "";
    updateEmptyState(scanState, emptyMessage, scanState === "scanning" ? t("scanBusy") : emptyMessage);
    allSelectionCheckbox.checked = items.length > 0 && selectedCount === items.length;
    allSelectionCheckbox.indeterminate = selectedCount > 0 && selectedCount < items.length;
    allSelectionCheckbox.disabled = busy || items.length === 0;
    allSelectionCheckbox.title = t(allSelectionCheckbox.checked ? "clearAllTitle" : "selectAllTitle");
    allSelectionCheckbox.setAttribute("aria-label", t(allSelectionCheckbox.checked ? "clearAll" : "selectAll"));
    resetOrderButton.disabled = busy || snapshot.initialOrderAndSelection;
  }

  return {render, renderProgress};
}
