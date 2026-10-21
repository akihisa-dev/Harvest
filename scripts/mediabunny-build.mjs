import {readFile, mkdir, writeFile, copyFile, realpath} from "node:fs/promises";
import {join, dirname} from "node:path";
import {build} from "esbuild";

// Fixture creation uses the upstream bundle in a separate test page.
export const mediabunnyExports = [
  "AudioSampleSink", "BlobSource", "BufferSource", "BufferTarget", "Conversion",
  "EncodedAudioPacketSource", "EncodedPacketSink", "EncodedVideoPacketSource",
  "Input", "MP4", "Mp4OutputFormat", "Output", "QUALITY_HIGH", "WEBM",
];

// Match the readable pinned source instead of depending on minifier names.
// The audio iterator and all timestamps remain unchanged.
export function adaptMediabunnyVideoTiming(source, helperPath = "../../../core/video-sample-timing.js") {
  const videoLoop = /(const sink = new VideoSampleSink\(track\);\s+for await \((?:using sample|const sample_1) of )sink\.samples\(this\._startTimestamp, this\._endTimestamp\)/g;
  if ([...source.matchAll(videoLoop)].length !== 1) {
    throw new Error("固定版mediabunnyの映像変換経路を確認できません。");
  }
  return `// Modified by Harvest: preserve video samples with missing durations.\n`
    + `import {videoSamplesWithDuration as harvestVideoSamples} from ${JSON.stringify(helperPath)};\n`
    + source.replace(videoLoop, "$1harvestVideoSamples(sink.samples(this._startTimestamp, this._endTimestamp), () => track.getDurationFromMetadata())");
}

export async function copyMediabunnyVendor(root, stage) {
  const packageRoot = await realpath(join(root, "node_modules", "mediabunny"));
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (pkg.version !== "1.61.0") throw new Error("固定版mediabunnyを使用してください。");
  const vendor = join(stage, "app", "vendor", "mediabunny");
  const helper = "../../../core/video-sample-timing.js";
  const conversion = join(packageRoot, "dist", "modules", "src", "conversion.js");
  const result = await build({
    stdin: {
      contents: `export {${mediabunnyExports.join(",")}} from "mediabunny";`,
      resolveDir: root,
      sourcefile: "harvest-mediabunny-entry.js",
    },
    bundle: true, platform: "browser", format: "esm", target: "es2022",
    minify: true, legalComments: "inline", write: false,
    plugins: [{name: "harvest-video-timing", setup(builder) {
      builder.onLoad({filter: /[/\\]conversion\.js$/}, async ({path}) => {
        if (path !== conversion) throw new Error("想定外の動画変換モジュールです。");
        return {contents: adaptMediabunnyVideoTiming(await readFile(path, "utf8"), helper), resolveDir: dirname(path)};
      });
      builder.onResolve({filter: /^\.\.\/\.\.\/\.\.\/core\/video-sample-timing\.js$/}, () => ({path: helper, external: true}));
    }}],
  });
  await mkdir(vendor, {recursive: true});
  await writeFile(join(vendor, "index.js"), result.outputFiles[0].contents);
  await copyFile(join(packageRoot, "LICENSE"), join(vendor, "LICENSE"));

  // Include the editable modified MPL file; SOURCE.md identifies unchanged sources.
  const sourceDirectory = join(stage, "source", "vendor", "mediabunny");
  await mkdir(sourceDirectory, {recursive: true});
  await writeFile(join(sourceDirectory, "conversion.ts"), adaptMediabunnyVideoTiming(
    await readFile(join(packageRoot, "src", "conversion.ts"), "utf8"), "../../src/core/video-sample-timing.js"));
  await copyFile(join(packageRoot, "LICENSE"), join(sourceDirectory, "LICENSE"));
}
