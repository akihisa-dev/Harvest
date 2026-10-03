/** Owns the draft URL and its presentation alongside the last committed result source. */
export function createSourceInputController(options) {
    const { input, display, dropOverlay } = options;
    const eventTarget = options.eventTarget ?? document;
    let resultSourceUrl = null;
    let displayCleared = false;
    let dragDepth = 0;
    function render() {
        const draft = input.value.trim();
        const url = displayCleared && !draft ? "" : resultSourceUrl ?? draft;
        display.textContent = url
            ? resultSourceUrl ? options.getResultFilename() : url
            : options.placeholder;
        display.dataset["hasUrl"] = String(Boolean(url));
    }
    function show() {
        if (options.isBusy())
            return;
        if (!input.value && resultSourceUrl && !displayCleared)
            input.value = resultSourceUrl;
        display.hidden = true;
        input.hidden = false;
        input.focus();
        input.select();
    }
    function hide() {
        input.hidden = true;
        display.hidden = false;
        render();
    }
    function clearAfterExport() {
        displayCleared = true;
        input.value = "";
        hide();
    }
    function setDraft(url) {
        input.value = url;
        render();
    }
    function isPageUrlDrag(event) {
        return Boolean(event.dataTransfer?.types.includes("text/uri-list") || event.dataTransfer?.types.includes("text/plain"));
    }
    display.addEventListener("click", show);
    input.addEventListener("input", render);
    input.addEventListener("blur", hide);
    input.addEventListener("keydown", event => { if (event.key === "Enter")
        options.onScan(); });
    eventTarget.addEventListener("dragenter", event => {
        if (isPageUrlDrag(event) && !options.isReordering())
            dragDepth += 1;
    });
    eventTarget.addEventListener("dragleave", event => {
        if (!isPageUrlDrag(event) && dragDepth === 0)
            return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0)
            dropOverlay.hidden = true;
    });
    eventTarget.addEventListener("dragover", event => {
        if (options.isBusy() || options.isReordering() || !isPageUrlDrag(event)) {
            dropOverlay.hidden = true;
            return;
        }
        event.preventDefault();
        if (event.dataTransfer)
            event.dataTransfer.dropEffect = "copy";
        dropOverlay.hidden = false;
    });
    eventTarget.addEventListener("drop", event => {
        dragDepth = 0;
        dropOverlay.hidden = true;
        const dropped = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain") || "";
        const url = dropped.split(/\r?\n/).find(line => line && !line.startsWith("#"))?.trim();
        if (!url || !/^https?:\/\//i.test(url))
            return;
        event.preventDefault();
        if (options.isBusy() || options.isReordering())
            return;
        setDraft(url);
        hide();
        options.onScan();
    });
    return {
        get enteredUrl() { return input.value.trim(); },
        render, show, hide, setDraft, clearAfterExport,
        commitResult(sourcePage) {
            resultSourceUrl = sourcePage;
            displayCleared = false;
            render();
        },
        reset() {
            resultSourceUrl = null;
            clearAfterExport();
        },
    };
}
