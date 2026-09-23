const openButton = document.querySelector<HTMLButtonElement>("#open-workspace");
const statusElement = document.querySelector<HTMLParagraphElement>("#status");

if (!openButton || !statusElement) throw new Error("Popup elements are missing.");

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const sourceId = tab?.id;
    const url = new URL(chrome.runtime.getURL("app/index.html"));
    if (sourceId !== undefined) url.searchParams.set("tab", String(sourceId));
    await chrome.tabs.create({url: url.href});
    window.close();
  } catch {
    statusElement.textContent = "画面を開けませんでした。もう一度お試しください。";
    openButton.disabled = false;
  }
});
