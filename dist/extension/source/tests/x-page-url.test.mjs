import assert from 'node:assert/strict';
import test from 'node:test';
import {isXBookmarkUrl} from '../dist/extension/core/x-page-url.js';
import {xPageTarget} from '../dist/extension/app/browser/x-page-acquisition.js';

const cases=[
 ['https://x.com/i/history',true],['https://twitter.com/i/bookmarks',true],
 ['HTTP://WWW.X.COM/I/BOOKMARKS/?a=1#x',true],['https://www.twitter.com/i/history/child',true],
 ['https://x.com/i/bookmarks?x=1#x',true],['https://x.com/i/bookmarks-extra',false],
 ['https://x.com/i/historystuff',false],['https://x.com/user/status/123',false],
 ['https://x.com.example.test/i/bookmarks',false],['https://example.test/i/bookmarks',false],
 ['ftp://x.com/i/bookmarks',false],['https://x.com/%69/bookmarks',false],
 ['https://x.com:443/i/bookmarks',false],['https://x.com:8443/i/bookmarks',false],
 ['https://x.com/i/history#x',true],['https://x.com/i/bookmarks/',true],
 ['https://X.COM/i/history',true],['https://x.com/i/bookmarks//child',true],
];
for(const [url,expected] of cases)test(`X一覧の共有分類: ${url}`,()=>{
 assert.equal(isXBookmarkUrl(url),expected);
 assert.equal(isXBookmarkUrl(url,true),expected);
 assert.equal(xPageTarget(url)?.bookmarkPage??false,expected);
});
test('raw URLとブラウザーが正規化したURLの境界を維持する',()=>{
 const raw='https://x.com/a/../i/bookmarks';
 assert.equal(isXBookmarkUrl(raw),false);
 assert.equal(isXBookmarkUrl(raw,true),true);
 assert.equal(xPageTarget(raw).bookmarkPage,true);
 assert.equal(isXBookmarkUrl(new URL(raw).href),true);
 assert.equal(isXBookmarkUrl(new URL('https://x.com:443/i/bookmarks').href),true);
 assert.deepEqual(xPageTarget('https://x.com/i/bookmarks','https://x.com/user/status/123/video/1'),
  {bookmarkPage:true,postId:'123',expectVideo:true});
});
