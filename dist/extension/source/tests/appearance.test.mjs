import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/style.css", import.meta.url), "utf8");
function luminance(hex) {
  const digits = hex.length === 3 ? [...hex].map(value => value + value).join("") : hex;
  const rgb = [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function palette(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*#([\da-f]+);/gi)].map(match => [match[1], match[2]]));
}

test("明暗の自動追従でも本文・補助文・選択ボタンの文字を読める", () => {
  const lightBlock = css.match(/:root\s*\{([^}]+)\}/)?.[1];
  const darkBlock = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]+)\}/)?.[1];
  assert.ok(lightBlock);
  assert.ok(darkBlock, "OSまたはブラウザーの明暗設定を使う");
  assert.match(lightBlock, /color-scheme:\s*light dark/);
  const light = palette(lightBlock);
  const dark = {...light, ...palette(darkBlock)};
  for (const theme of [light, dark]) {
    for (const [text, background] of [
      ["ink", "surface"], ["ink", "background"], ["muted", "surface"],
      ["muted", "background"], ["pressed-ink", "ink"],
      ["pressed-ink", "pressed-hover"], ["pressed-ink", "pressed-active"],
    ]) {
      const first = luminance(theme[text]);
      const second = luminance(theme[background]);
      assert.ok((Math.max(first, second) + .05) / (Math.min(first, second) + .05) >= 4.5,
        `${text} / ${background}の文字のコントラストを保つ`);
    }
  }
});

test("上部と画像領域の配分を内容によらず固定し操作を切り捨てない", () => {
  const header = css.match(/^\.app-header\s*\{([^}]+)\}/m)?.[1];
  assert.ok(header);
  assert.match(header, /(?:^|;)\s*height:\s*clamp\(168px, 34dvh, 240px\)/, "内容によらず同じ画面では同じ高さを使う");
  const maximum = Number(header.match(/max-height:\s*(\d+)dvh/)?.[1]);
  assert.ok(maximum > 0 && maximum <= 60, "画像領域に画面の40%以上を残す");
  assert.match(header, /overflow-y:\s*auto/, "上部の操作はスクロールで到達できる");
  assert.match(header, /scrollbar-width:\s*none/, "上部にスクロールバーを表示しない");
  assert.match(css, /\.app-header::-webkit-scrollbar\s*\{\s*display:\s*none/, "Chromeでも上部のスクロールバーを表示しない");
  assert.match(header, /grid-template-rows:\s*max-content max-content/, "固定領域の中で内容を圧縮せずスクロールさせる");
});
