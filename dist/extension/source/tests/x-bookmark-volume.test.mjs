import assert from 'node:assert/strict';
import test from 'node:test';
import {parseXMedia} from '../dist/extension/core/x-media.js';
test('読込済みブックマークは一覧全体の探索ノード数で後続投稿を失わない', () => {
  const posts = Array.from({length: 3000}, (_, i) => ({key: `post:${i}`, postId: String(i), observed: [], roots: [{
    requireIdentity: true, player: false, value: {tweet_results: {result: {rest_id: String(i), legacy: {extended_entities: {media: [
      {type: 'photo', media_url_https: `https://pbs.twimg.com/media/image${i}.jpg`},
    ]}}}}},
  }]}));
  const result = parseXMedia({url: 'https://x.com/i/history', posts, limited: false});
  assert.equal(result.media.length, 3000);
  assert.equal(result.media.at(-1).url, 'https://pbs.twimg.com/media/image2999?format=jpg&name=orig');
  assert.equal(result.diagnostics.limited, false);
});
