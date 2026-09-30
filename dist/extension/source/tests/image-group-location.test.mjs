import assert from 'node:assert/strict';
import test from 'node:test';
import {groupImages,imageGroupLabel} from '../dist/extension/core/images.js';

test('同じ末尾フォルダー名でも親パスとオリジンが異なる系列を分離する',()=>{
  const roots=['https://example.com/book-a/pages/','https://example.com/book-b/pages/','https://example.com:8443/book-a/pages/','http://example.com/book-a/pages/'];
  const groups=Object.values(groupImages(roots.flatMap(root=>[root+'001.jpg',root+'002.jpg'])));
  assert.equal(groups.length,4);
  roots.forEach(root=>assert.ok(groups.some(group=>group.items.every(url=>url.startsWith(root)) && group.items.length===2)));
  assert.equal(imageGroupLabel(roots[0]+'001.jpg'),'example.com / pages');
});
