interface TimedVideoSample {
  readonly timestamp: number;
  readonly duration: number;
  setDuration(duration: number): void;
  close(): void;
}

/** Preserve known durations; resolve a missing duration from presentation times, never an assumed FPS. */
export async function* videoSamplesWithDuration<T extends TimedVideoSample>(
  samples: AsyncIterable<T>,
  getEndTimestamp: () => Promise<number | null>,
): AsyncGenerator<T, void, unknown> {
  let pending: T | undefined;
  async function* emit(sample: T, nextTimestamp?: number): AsyncGenerator<T, void, unknown> {
    try {
      if (sample.duration === 0) {
        const end = nextTimestamp ?? await getEndTimestamp();
        if (end === null || !Number.isFinite(end) || end <= sample.timestamp) {
          throw new Error("動画のフレームの表示時間を確認できないためMP4へ変換できません。");
        }
        sample.setDuration(end - sample.timestamp);
      }
      yield sample;
    } finally {
      sample.close();
    }
  }
  try {
    for await (const sample of samples) {
      const previous = pending;
      pending = sample;
      if (previous) yield* emit(previous, sample.timestamp);
    }
    const last = pending;
    pending = undefined;
    if (last) yield* emit(last);
  } finally {
    pending?.close();
  }
}
