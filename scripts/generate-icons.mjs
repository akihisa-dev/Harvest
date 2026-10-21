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

    return [16, 32, 48, 128, 1024].map(size => {
      // Render the vector at 4x each output size, then halve twice. A single
      // large reduction can skip narrow edge coverage and leave jagged diagonals.
      let canvas = window.document.createElement("canvas");
      canvas.width = canvas.height = size * 4;
      const context = canvas.getContext("2d");
      context.scale(canvas.width / 512, canvas.height / 512);
      context.fillStyle = "#202020";
      context.beginPath();
      context.roundRect(32, 32, 448, 448, 120);
      context.fill();
      // Keep the original grain silhouette, position, proportions, and colors.
      context.drawImage(image, -51.2, -40.4, 614.4, 614.4);
      while (canvas.width > size) {
        const reduced = window.document.createElement("canvas");
        reduced.width = reduced.height = canvas.width / 2;
        const output = reduced.getContext("2d");
        output.imageSmoothingQuality = "high";
        output.drawImage(canvas, 0, 0, reduced.width, reduced.height);
        canvas = reduced;
      }
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
