import assert from 'node:assert/strict';
import test from 'node:test';
import {parseXMedia, xMediaUrlKey, xOriginalPhotoUrl} from '../dist/extension/core/x-media.js';
const image = name => `https://pbs.twimg.com/media/${name}.jpg`;
const original = name => `https://pbs.twimg.com/media/${name}?format=jpg&name=orig`;
const poster = name => `https://pbs.twimg.com/ext_tw_video_thumb/${name}/img/frame.jpg`;
const clip = name => `https://video.twimg.com/${name}.mp4`;
const photo = name => ({type: 'photo', media_url_https: image(name)});
const video = (name, variants = [clip(name)]) => ({type: 'video', media_key: name, media_url_https: poster(name),
  video_info: {variants: variants.map((url, bitrate) => ({url, bitrate, content_type: 'video/mp4'}))}});
const tweet = (id, media) => ({rest_id: id, legacy: {extended_entities: {media}}});
const post = (id, value, observed = [], requireIdentity = true) => ({key: `post:${id}`, postId: id, observed,
  roots: [{value, requireIdentity, player: false}]});
const scan = posts => ({url: 'https://x.com/i/history', limited: false, posts});

test('引用・再投稿・可視性ラッパーを一覧で展開し、単独投稿では引用を除く', () => {
  const own = tweet('123', [photo('own')]);
  own.quoted_status_result = {result: {__typename: 'TweetWithVisibilityResults', tweet: tweet('456', [photo('quoted'), video('quoted')])}};
  const snapshot = scan([post('123', {tweet: own})]);
  assert.equal(parseXMedia(snapshot).media.length, 3);
  assert.deepEqual(parseXMedia(snapshot, '123').media.map(m => m.url), [original('own')]);
  const repost = {rest_id: '789', legacy: {entities: {media: [photo('duplicate-outer')]},
    retweeted_status_result: {result: own}}};
  assert.deepEqual(parseXMedia(scan([post('789', {tweet: repost})])).media.map(m => m.url),
    [original('own'), original('quoted'), clip('quoted')]);
});

test('完全なメディア一覧を優先し、別投稿と未確認の祖先データを取り込まない', () => {
  const own = tweet('123', [photo('first'), photo('second')]);
  own.legacy.entities = {media: [photo('stale')]};
  const p = post('123', {tweet: own, tweetResults: [tweet('456', [photo('other')])]});
  p.roots.push({value: {media: [photo('unowned')]}, requireIdentity: true, player: false});
  assert.deepEqual(parseXMedia(scan([p])).media.map(m => m.url), [original('first'), original('second')]);
});

test('動画プレビューは写真にせず、別投稿の動画で不足を埋めない', () => {
  const result = parseXMedia(scan([
    post('123', {tweet: tweet('123', [photo('still')])}, [{kind: 'image', url: poster('missing')}]),
    post('456', {tweet: tweet('456', [video('missing')])}),
  ]));
  assert.deepEqual(result.missingPosts, ['post:123']);
  assert.deepEqual(result.media.map(m => m.kind), ['image', 'video']);
  assert.equal(result.diagnostics.unresolved, 1);
});

test('複数プレイヤーを1本で成功扱いせず、未知の動画形式も不足として返す', () => {
  const result = parseXMedia(scan([post('123', {tweet: tweet('123', [video('one')])}, [
    {kind: 'video', url: 'blob:https://x.com/a'}, {kind: 'video', url: 'blob:https://x.com/b'},
  ])]));
  assert.deepEqual(result.missingPosts, ['post:123']);
  const unknown = video('unknown');
  unknown.video_info.variants = [{url: 'https://video.twimg.com/playlist.m3u8', content_type: 'application/x-mpegURL'}];
  assert.deepEqual(parseXMedia(scan([post('123', {tweet: tweet('123', [unknown])})])).missingPosts, ['post:123']);
});

test('画像サイズと形式表記を統合し、異なるパスは残す', () => {
  assert.equal(xMediaUrlKey(image('first')), xMediaUrlKey('https://pbs.twimg.com/media/first?name=large&format=jpg'));
  const result = parseXMedia(scan([post('123', {tweet: tweet('123', [photo('first'), photo('second')])}, [
    {kind: 'image', url: 'https://pbs.twimg.com/media/first?name=small&format=jpg'},
  ])]));
  assert.equal(result.media.length, 2);
  assert.deepEqual(result.missingPosts, []);
});

test('同一メディアIDと明示的な画質候補だけを統合する', () => {
  const a = video('one', [clip('low'), clip('high')]);
  const b = video('one', [clip('another')]);
  const c = video('two', [clip('separate')]);
  const result = parseXMedia(scan([post('123', {tweet: tweet('123', [a, b, c])})]));
  assert.equal(result.media.length, 2);
  assert.equal(result.media[0].url, clip('high'));
  assert.deepEqual(new Set(result.media[0].variantUrls), new Set([clip('low'), clip('another')]));
});

test('探索上限を完全な解析と区別する', () => {
  const snapshot = scan([post('123', {tweet: tweet('123', [photo('first')])})]);
  snapshot.limited = true;
  assert.equal(parseXMedia(snapshot).diagnostics.limited, true);
});

test('一覧の縮小写真と個別投稿の写真を同じオリジナルURLで保存する', () => {
  const small = 'https://pbs.twimg.com/media/photo?format=jpg&name=small';
  const large = 'https://pbs.twimg.com/media/photo?format=jpg&name=large';
  const original = 'https://pbs.twimg.com/media/photo?format=jpg&name=orig';
  const timeline = parseXMedia(scan([post('123', {tweet: tweet('123', [photo('photo')])}, [{kind: 'image', url: small}])]));
  const single = parseXMedia(scan([post('123', {}, [{kind: 'image', url: large}])]), '123');
  assert.equal(timeline.media.length, 1);
  assert.equal(timeline.media[0].url, original);
  assert.equal(single.media[0].url, original);
});

for (const [input, expected] of [
  ['https://pbs.twimg.com/media/a.jpg:small', 'https://pbs.twimg.com/media/a?format=jpg&name=orig'],
  ['https://pbs.twimg.com/media/a.png', 'https://pbs.twimg.com/media/a?format=png&name=orig'],
  ['https://pbs.twimg.com/media/a?format=png&name=900x900', 'https://pbs.twimg.com/media/a?format=png&name=orig'],
  ['https://pbs.twimg.com/media/a?format=gif&name=small', 'https://pbs.twimg.com/media/a?format=gif&name=orig'],
  ['https://pbs.twimg.com/profile_images/a.jpg?name=small', 'https://pbs.twimg.com/profile_images/a.jpg?name=small'],
  ['https://pbs.twimg.com/ext_tw_video_thumb/a.jpg?name=small', 'https://pbs.twimg.com/ext_tw_video_thumb/a.jpg?name=small'],
  ['https://other.test/media/a.jpg?name=small', 'https://other.test/media/a.jpg?name=small'],
  ['https://pbs.twimg.com/media/a?format=unknown&name=small', 'https://pbs.twimg.com/media/a?format=unknown&name=small'],
]) test(`オリジナルサイズ変換の対象と形式を限定する: ${input}`, () => {
  assert.equal(xOriginalPhotoUrl(input), expected);
});

test('旧式サイズ表記とクエリ表記の同じ写真を重複させない', () => {
  const result = parseXMedia(scan([post('123', {}, [
    {kind: 'image', url: 'https://pbs.twimg.com/media/a.jpg:small'},
    {kind: 'image', url: 'https://pbs.twimg.com/media/a?format=jpg&name=large'},
  ])]));
  assert.deepEqual(result.media, [{kind: 'image', url: 'https://pbs.twimg.com/media/a?format=jpg&name=orig'}]);
});
