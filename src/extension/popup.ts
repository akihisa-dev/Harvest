const statusElement = document.querySelector<HTMLParagraphElement>("#status");

if (!statusElement) {
  throw new Error("Popup status element is missing.");
}

statusElement.textContent = "Harvest拡張機能の初期画面です。機能はまだ定義されていません。";
