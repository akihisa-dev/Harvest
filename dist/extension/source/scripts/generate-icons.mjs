import {readFile, writeFile} from "node:fs/promises";
import {chromium} from "playwright";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("assets/brand/harvest-geometric-logo.svg", root), "utf8");
const browser = await chromium.launch({channel: "chrome", headless: true});
try {
  const page = await browser.newPage();
  const icons = await page.evaluate(async source => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    document.querySelector("g").setAttribute("fill", "#f5f5f3");
    const image = new Image();
    image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`;
    await image.decode();

    const master = window.document.createElement("canvas");
    master.width = master.height = 1024;
    const context = master.getContext("2d");
    context.scale(2, 2);
    context.fillStyle = "#202020";
    context.beginPath();
    context.roundRect(32, 32, 448, 448, 120);
    context.fill();
    // Center the existing grain silhouette at 1.2x, retaining its proportions.
    context.drawImage(image, -51.2, -40.4, 614.4, 614.4);

    return [16, 32, 48, 128, 1024].map(size => {
      const canvas = window.document.createElement("canvas");
      canvas.width = canvas.height = size;
      const output = canvas.getContext("2d");
      output.imageSmoothingQuality = "high";
      output.drawImage(master, 0, 0, size, size);
      return {size, png: canvas.toDataURL("image/png").split(",")[1]};
    });
  }, source);
  for (const {size, png} of icons) {
    const path = size === 1024 ? "assets/brand/harvest-logo-master.png" : `assets/icons/icon-${size}.png`;
    await writeFile(new URL(path, root), Buffer.from(png, "base64"));
  }
} finally {
  await browser.close();
}
console.log("Generated geometric Harvest icons (16, 32, 48, 128, and 1024px).");
