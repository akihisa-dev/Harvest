import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {animationPanel, readCompletedDownload} from './support/animation-panel.mjs';
import {startServer} from './support/browser.mjs';
import {mp4Bytes} from './media-fixtures.mjs';
import {formatFileSize} from '../dist/extension/core/file-size.js';

test('Streamの解析・一覧・MP4保存を操作し、65 MiBの原本をChromeで直接保存する', {timeout: 60000}, async t => {
  const recording = Buffer.alloc(65 * 1024 ** 2);
  recording.set(mp4Bytes);
  recording.writeUInt32BE(recording.length - mp4Bytes.length, mp4Bytes.length);
  recording.write('free', mp4Bytes.length + 4);
  let gets = 0;
  const server = await startServer(t, (request, response) => {
    gets++;response.writeHead(200, {'content-type': 'video/mp4', 'content-length': String(recording.length)});response.end(recording);
  });
  const localUrl = `http://127.0.0.1:${server.address().port}/meeting.mp4`;
  const pageUrl = 'https://contoso.sharepoint.com/sites/team/_layouts/15/stream.aspx?id=%2Fsites%2Fteam%2FDocuments%2Fmeeting.mp4';
  const {page} = await animationPanel(t, new Map());
  await page.evaluate(({pageUrl, localUrl, bytes}) => {
    window.fixturePageUrl = pageUrl;
    const query = chrome.tabs.query.bind(chrome.tabs), get = chrome.tabs.get.bind(chrome.tabs), execute = chrome.scripting.executeScript.bind(chrome.scripting);
    chrome.tabs.query = async options => options.active ? [{id: 999999, url: pageUrl, title: '長い会議録画', status: 'complete'}] : query(options);
    chrome.tabs.get = async id => id === 999999 ? {id, url: pageUrl, status: 'complete'} : get(id);
    chrome.scripting.executeScript = async request => request.target.tabId !== 999999 ? execute(request) : [{documentId: 'recording-doc',
      result: request.func.name === 'scanDocument' ? {url: pageUrl, title: '長い会議録画', images: [], hasFrames: true} : pageUrl}];
    window.recordingHeads = 0;window.recordingBlobUrls = 0;
    const fetchOriginal = window.fetch.bind(window), create = URL.createObjectURL.bind(URL);
    window.fetch = async (url, options) => {
      if (String(url).startsWith('https://contoso.sharepoint.com/')) {
        if (options?.method !== 'HEAD') throw new Error('Recording body entered panel memory');
        window.recordingHeads++;
        return new Response(null, {headers: {'content-type': 'video/mp4', 'content-length': String(bytes)}});
      }
      return fetchOriginal(url, options);
    };
    URL.createObjectURL = blob => {window.recordingBlobUrls++;return create(blob);};
    const download = chrome.downloads.download.bind(chrome.downloads);
    chrome.downloads.download = async options => {
      const url = new URL(options.url);
      if (url.origin !== 'https://contoso.sharepoint.com' || !url.pathname.endsWith('/download.aspx')) throw new Error('Not an official recording download');
      return download({...options, url: localUrl});
    };
  }, {pageUrl, localUrl, bytes: recording.length});
  await page.locator('#scan').click();
  await page.waitForFunction(() => document.querySelector('#scan').dataset.scanning === 'false' && !document.querySelector('#scan').disabled);
  await page.locator('#video-export-format-mp4').check();
  assert.match(await page.locator('#images').innerText(), /meeting\.mp4/);
  assert.ok((await page.locator('#images').innerText()).includes(formatFileSize(recording.length)));
  await page.locator('#export').click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'success');
  const result = await page.evaluate(async () => ({item: (await chrome.downloads.search({id: window.downloadIds.at(-1)}))[0], heads: window.recordingHeads, blobs: window.recordingBlobUrls}));
  assert.equal(result.item.state, 'complete');assert.equal(result.item.fileSize, recording.length);
  assert.equal(result.blobs, 0);assert.ok(result.heads >= 2);assert.equal(gets, 1);
  const saved = await readCompletedDownload(result.item.filename);
  assert.equal(createHash('sha256').update(saved).digest('hex'), createHash('sha256').update(recording).digest('hex'));
  assert.equal(await page.locator('#source-url').inputValue(), '');
});
