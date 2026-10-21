import assert from 'node:assert/strict';
import test from 'node:test';
import {streamDownloadUrl, isStreamRecording, isStreamRecordingPage, streamRecordingFilename} from '../dist/extension/core/stream-recording.js';
import {inspectStreamRecording} from '../dist/extension/app/browser/stream-recording.js';
import {scanTab} from '../dist/extension/app/browser/page-access.js';
import {ImageCollection} from '../dist/extension/core/image-collection.js';
import {isPageScan} from '../dist/extension/app/contracts/page-contracts.js';
import {createMixedExportController} from '../dist/extension/app/panel/mixed-export-controller.js';
import {downloadManagedRecording} from '../dist/extension/app/browser/managed-download.js';

const pageUrl = 'https://contoso-my.sharepoint.com/personal/user/_layouts/15/stream.aspx?id=' + encodeURIComponent('/personal/user/Documents/Recordings/定例 会議.mp4');
const url = streamDownloadUrl(pageUrl), bytes = 3 * 1024 ** 3;
const tick = () => new Promise(resolve => setImmediate(resolve));
function install(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}
function head(t, handler = () => new Response(null, {headers: {'content-type': 'video/mp4', 'content-length': String(bytes)}})) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (target, options) => {
    calls.push({target, options});
    assert.equal(target, url);assert.equal(options.method, 'HEAD');
    assert.equal(options.credentials, 'include');assert.equal(options.redirect, 'error');
    return handler(target, options);
  });
  return calls;
}
function chromeApi(t) {
  const items = new Map(), listeners = new Set(), starts = [], cancelled = [];
  const api = {
    i18n: {getUILanguage: () => 'ja'},
    downloads: {
      async download(options) {const id = starts.length + 1;starts.push(options);items.set(id, {id, state: 'in_progress'});return id;},
      async search({id}) {return items.has(id) ? [items.get(id)] : [];},
      async cancel(id) {cancelled.push(id);finish(id, 'interrupted', {error: 'USER_CANCELED'});},
      onChanged: {addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener)},
    },
  };
  const finish = (id, state, extra = {}) => {
    items.set(id, {id, state, mime: 'video/mp4', fileSize: bytes, ...extra});
    for (const listener of listeners) listener({id, state: {current: state}, ...(extra.error ? {error: {current: extra.error}} : {})});
  };
  install(t, 'chrome', api);
  return {api, finish, starts, cancelled, listeners};
}

test('一覧型の録画は同一ライブラリーの選択MP4だけを取得し、通常の一覧は録画と判定しない', () => {
  for (const prefix of ['', '/sites/team', '/teams/team/subsite', '/personal/user']) {
    const library = `${prefix}/Shared Documents`;
    const page = new URL(`https://contoso.sharepoint.com${prefix}/Shared%20Documents/Forms/AllItems.aspx`);
    for (const file of [null, library, `${library}/preview.png`, '/sites/other/movie.mp4', `${prefix}/Other/movie.mp4`, `${library}/../Other/movie.mp4`]) {
      page.search = '';
      if (file !== null) page.searchParams.set('id', file);
      assert.equal(streamDownloadUrl(page.href), null, page.href);
      assert.equal(isStreamRecordingPage(page.href), false, page.href);
    }
    page.searchParams.set('id', `${library}/Recordings/定例.mp4`);
    assert.equal(isStreamRecordingPage(page.href), true);
    const download = new URL(streamDownloadUrl(page.href));
    assert.equal(download.pathname, `${prefix}/_layouts/15/download.aspx`);
    assert.equal(new URL(download.searchParams.get('SourceUrl')).pathname, `${prefix}/Shared%20Documents/Recordings/%E5%AE%9A%E4%BE%8B.mp4`);
  }
});

test('Streamの会議録画を同一サイトの通常のダウンロード先に限定する', () => {
  assert.equal(new URL(url).pathname, '/personal/user/_layouts/15/download.aspx');
  assert.equal(new URL(url).searchParams.get('SourceUrl'), 'https://contoso-my.sharepoint.com/personal/user/Documents/Recordings/%E5%AE%9A%E4%BE%8B%20%E4%BC%9A%E8%AD%B0.mp4');
  assert.equal(streamRecordingFilename({pageUrl}), '定例 会議.mp4');
  const guid = '12345678-1234-abcd-1234-123456789abc';
  assert.equal(new URL(streamDownloadUrl(`https://contoso.sharepoint.com/sites/team/_layouts/15/stream.aspx?sourcedoc={${guid}}`)).searchParams.get('UniqueId'), guid);
  assert.ok(streamDownloadUrl(pageUrl.replace('stream.aspx', 'onedrive.aspx')));
  for (const invalid of [pageUrl.replace('.sharepoint.com', '.sharepoint.com.evil.test'), pageUrl.replace('https:', 'http:'),
    pageUrl.replace('https://', 'https://user:secret@'), pageUrl + '&ID=other',
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('//evil.test/file.mp4')),
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('/sites/another/file.mp4')),
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('/personal/user/../../private/file.mp4')),
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('/personal/user/a\\file.mp4')),
    pageUrl.replace(/id=.*/, 'id=' + encodeURIComponent('/personal/user/file.m3u8'))]) assert.equal(streamDownloadUrl(invalid), null, invalid);
});

test('3 GiBの録画は本文を読まず容量と録画情報を動画一覧まで引き継ぐ', async t => {
  head(t, () => {
    const response = new Response(null, {headers: {'content-type': 'video/mp4', 'content-length': String(bytes)}});
    for (const name of ['blob', 'arrayBuffer', 'text']) response[name] = () => {throw new Error('Do not buffer recording');};
    return response;
  });
  const stream = await inspectStreamRecording(pageUrl);
  assert.deepEqual(stream, {pageUrl, bytes});
  const media = [{url, kind: 'video', stream}];
  assert.equal(isPageScan({url: pageUrl, title: 'meeting', images: [], media}), true);
  assert.equal(isStreamRecording({...stream, pageUrl: pageUrl.replace('contoso', 'other')}, url), false);
  assert.equal(isStreamRecording({...stream, bytes: -1}, url), false);
  const collection = new ImageCollection();collection.replace([url], pageUrl, media);
  assert.deepEqual(collection.items[0].stream, stream);
  collection.restoreInitialOrderAndSelection();
  assert.equal(Object.values(collection.groups)[0].label, 'MP4 (1件)');
});

const failureMessages = {401: /HTTP 401/, 403: /HTTP 403/, 404: /HTTP 404/, 302: /エラーを返し/, html: /動画以外/, manifest: /動画以外/, empty: /形式または容量/, redirect: /通信または転送先/};
for (const failure of Object.keys(failureMessages).map(value => /^\d+$/.test(value) ? Number(value) : value)) test(`録画の権限・認証・応答が不適切なら取得を拒否する: ${failure}`, async t => {
  head(t, () => {
    if (failure === 'redirect') throw new TypeError('redirect rejected');
    if (typeof failure === 'number') return new Response(null, {status: failure});
    return new Response(null, {headers: {'content-type': failure === 'html' ? 'text/html' : failure === 'manifest' ? 'application/dash+xml' : 'video/mp4',
      'content-length': failure === 'empty' ? '0' : '10'}});
  });
  await assert.rejects(inspectStreamRecording(pageUrl), failureMessages[failure]);
});

for (const status of [405, 501]) for (const partial of [true, false]) test(`HEAD非対応${status}でも同じ取得先のGETから容量を確認し、本文を読み込まない: partial=${partial}`, async t => {
  const calls = [];let cancelled = 0;
  t.mock.method(globalThis, 'fetch', async (target, options) => {
    calls.push(options);assert.equal(target, url);
    assert.equal(options.credentials, 'include');assert.equal(options.redirect, 'error');assert.equal(options.cache, 'no-store');
    if (options.method === 'HEAD') return new Response(null, {status});
    assert.equal(options.headers.Range, 'bytes=0-0');
    const response = new Response(new ReadableStream({cancel() {cancelled++;}}), {status: partial ? 206 : 200,
      headers: {'content-type': 'video/mp4', 'content-length': partial ? '1' : String(bytes), ...(partial ? {'content-range': `bytes 0-0/${bytes}`} : {})}});
    for (const name of ['blob', 'arrayBuffer', 'text']) response[name] = () => {throw new Error('Do not buffer recording');};
    return response;
  });
  assert.deepEqual(await inspectStreamRecording(pageUrl), {pageUrl, bytes});
  assert.equal(calls.length, 2);assert.equal(calls[0].signal, calls[1].signal);assert.equal(cancelled, 1);
});

for (const failure of [403, 405, 'bad-range', 'html']) test(`HEAD非対応後もGETの不正な応答を成功にしない: ${failure}`, async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return new Response(null, {status: 405});
    if (typeof failure === 'number') return new Response(null, {status: failure});
    return new Response(null, {status: 206, headers: {'content-type': failure === 'html' ? 'text/html' : 'video/mp4',
      'content-range': failure === 'bad-range' ? 'bytes 1-2/100' : 'bytes 0-0/100', 'content-length': '1'}});
  });
  await assert.rejects(inspectStreamRecording(pageUrl), failure === 403 ? /HTTP 403/ : failure === 405 ? /エラーを返し/ : failure === 'html' ? /動画以外/ : /形式または容量/);
  assert.equal(calls, 2);
});

test('通信障害と時間切れを権限不足と表示せず、中止はそのまま返す', async t => {
  head(t, () => {throw new TypeError('Failed to fetch');});
  await assert.rejects(inspectStreamRecording(pageUrl), /通信または転送先/);
  t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(new DOMException('Expired', 'TimeoutError')));
  await assert.rejects(inspectStreamRecording(pageUrl), /取得先の確認が時間切れ/);
  const controller = new AbortController();controller.abort();
  await assert.rejects(inspectStreamRecording(pageUrl, controller.signal), {name: 'AbortError'});
});

test('MP4添付名のある汎用バイナリだけを録画として扱い、不明な容量は推定しない', async t => {
  head(t, () => new Response(null, {headers: {'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="meeting.mp4"'}}));
  assert.deepEqual(await inspectStreamRecording(pageUrl), {pageUrl});
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {headers: {'content-type': 'application/octet-stream'}}));
  await assert.rejects(inspectStreamRecording(pageUrl), /動画以外/);
});

test('解析途中の移動を検出し、以前の文書の録画を公開しない', async t => {
  let moved = false;head(t, () => {moved = true;return new Response(null, {headers: {'content-type': 'video/mp4'}});});
  const event = {addListener() {}, removeListener() {}};
  install(t, 'chrome', {tabs: {onRemoved: event, get: async () => ({url: moved ? 'https://elsewhere.test/' : pageUrl})},
    scripting: {executeScript: async ({func}) => [{documentId: 'doc', result: func.name === 'scanDocument'
      ? {url: pageUrl, title: '会議録画', images: ['https://example.test/logo.png']} : pageUrl}]}});
  await assert.rejects(scanTab(1), /ページが移動/);
});

test('録画再生ページを一つの動画として解析し、ロゴや再生用候補を混ぜない', async t => {
  head(t);const event = {addListener() {}, removeListener() {}};
  install(t, 'chrome', {tabs: {onRemoved: event, get: async () => ({url: pageUrl})},
    scripting: {executeScript: async ({func}) => [{documentId: 'doc', result: func.name === 'scanDocument'
      ? {url: pageUrl, title: '会議録画', images: ['https://example.test/logo.png'], hasFrames: true} : pageUrl}]}});
  const result = await scanTab(1);
  assert.deepEqual(result.media, [{url, kind: 'video', stream: {pageUrl, bytes}}]);
  assert.deepEqual(result.images, []);assert.equal(result.hasFrames, false);
});

for (const extra of [{mime: 'text/html'}, {fileSize: 10}, {fileSize: 0}]) test(`Chromeが完了しても録画の形式・サイズが違えば成功にしない: ${JSON.stringify(extra)}`, async t => {
  head(t);const fake = chromeApi(t);
  const promise = downloadManagedRecording({pageUrl}, 'meeting.mp4', new AbortController().signal);
  const rejected = assert.rejects(promise, /形式または容量/);
  await tick();fake.finish(1, 'complete', extra);await rejected;
  assert.equal(fake.listeners.size, 0);
});

test('権限確認中の中止はダウンロードを開始せず、通信も中止する', async t => {
  const fake = chromeApi(t), controller = new AbortController();
  let requestSignal;
  head(t, (_, options) => new Promise((_, reject) => {requestSignal = options.signal;requestSignal.addEventListener('abort', () => reject(requestSignal.reason), {once: true});}));
  const promise = downloadManagedRecording({pageUrl}, 'meeting.mp4', controller.signal);
  const rejected = assert.rejects(promise, {name: 'AbortError'});
  controller.abort();await rejected;
  assert.equal(requestSignal.aborted, true);assert.equal(fake.starts.length, 0);
});

for (const format of ['mp4', 'recommend', 'original']) test(`長い録画の${format}保存を中止後、Chromeで未保存分だけ再試行する`, async t => {
  const calls = head(t), fake = chromeApi(t);
  install(t, 'document', {documentElement: {setAttribute() {}}, body: {dataset: {}}, querySelectorAll: () => []});
  const selected = [1, 2].map(() => ({url, sourcePage: pageUrl, selected: true, kind: 'video', stream: {pageUrl, bytes}}));
  let completed = 0;
  const controller = createMixedExportController({getSelectedItems: () => selected, getZipFilename: () => '会議.zip', getPdfFilename: () => '会議.pdf',
    isBusy: () => false, isDisposed: () => false, onBusyChange() {}, onStatus() {}, onCloseViewer() {}, onClearSourceUrl() {}, onCompleted() {completed++;}, onScrollToFailures() {}});
  t.mock.method(URL, 'createObjectURL', () => {throw new Error('Long recordings must not become Blobs');});
  const settings = {imageFormat: 'original', videoFormat: format, includeSourcePage: false};
  const first = controller.export(settings);await tick();
  assert.equal(fake.starts[0].url, url);fake.finish(1, 'complete');await tick();
  assert.equal(fake.starts.length, 2);controller.abort();await first;
  assert.deepEqual(fake.cancelled, [2]);assert.equal(completed, 0);
  const retry = controller.export(settings);await tick();fake.finish(3, 'complete');await retry;
  assert.equal(completed, 1);assert.equal(controller.pending, null);
  assert.deepEqual(fake.starts.map(item => item.filename), ['会議_001.mp4', '会議_002.mp4', '会議_002.mp4']);
  assert.ok(calls.every(call => call.options.method === 'HEAD'));
});

for(const name of ['meeting.mp4','進捗%20確認.mp4','folder%2Fmeeting.mp4','確認%25.mp4','進捗 50%.mp4','確認#1.mp4'])test(`録画の復号済みファイル名を二重に復号しない: ${name}`,()=>{
  const path='/sites/team/Documents/Recordings/'+name;
  const page=new URL('https://contoso.sharepoint.com/sites/team/_layouts/15/stream.aspx');page.searchParams.set('id',path);
  const download=streamDownloadUrl(page.href);
  const source=new URL(download).searchParams.get('SourceUrl');
  assert.equal(decodeURIComponent(new URL(source).pathname),path);
  assert.equal(streamRecordingFilename({pageUrl:page.href}),name);
  const embed=new URL('https://contoso.sharepoint.com/sites/team/_layouts/15/embed.aspx?UniqueId=12345678-1234-abcd-1234-123456789abc');
  embed.searchParams.set('file',name);
  assert.equal(streamRecordingFilename({pageUrl:embed.href}),name);
});

for(const count of [1,2])for(const format of ['original','recommend','mp4'])test(`録画${count}件の${format}は予告したMP4名で保存する`,async t=>{
 const {createExportPresentation}=await import('../dist/extension/app/panel/export-presentation.js');
 head(t);const fake=chromeApi(t);install(t,'document',{documentElement:{setAttribute(){}},body:{dataset:{}},querySelectorAll:()=>[]});
 let selected=Array.from({length:count},()=>({url,sourcePage:pageUrl,selected:true,kind:'video',stream:{pageUrl,bytes}}));
 const presentation=createExportPresentation({getTitle:()=> 'meeting',getSelection:()=>({format:'original',videoFormat:format,includeSourcePage:false,selected}),fallbackTitle:'Harvest',sourceHeading:'Source'});
 const anticipated=presentation.resultFilename;
 assert.equal(anticipated,count===1?'meeting.mp4':'meeting_001.mp4');
 const controller=createMixedExportController({getSelectedItems:()=>selected,getZipFilename:()=>presentation.zipFilename,getPdfFilename:()=>presentation.pdfFilename,
  isBusy:()=>false,isDisposed:()=>false,onBusyChange(){},onStatus(){},onCloseViewer(){},onClearSourceUrl(){},onCompleted(){},onScrollToFailures(){}});
 const work=controller.export({imageFormat:'original',videoFormat:format,includeSourcePage:false});await tick();
 assert.equal(fake.starts[0].filename,anticipated);
 for(let index=0;index<count;index++){fake.finish(index+1,'complete');await tick();}
 await work;assert.equal(fake.starts.length,count);
 selected=[];assert.equal(presentation.resultFilename,'meeting.zip');
 selected=[{url:'https://example.test/one.mp4',sourcePage:pageUrl,selected:true,kind:'video'},{url:'https://example.test/two.mp4',sourcePage:pageUrl,selected:true,kind:'video'}];
 if(format==='original')assert.equal(presentation.resultFilename,'meeting.zip');
});

function progressClock(t) {
 let serial=0;const timers=new Map();
 t.mock.method(globalThis,'setTimeout',(fn,delay)=>{assert.equal(delay,250);timers.set(++serial,fn);return serial;});
 t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
 return {timers,async step(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();await tick();}};
}

test('録画の受信量だけが変わっても自分のIDを照会し、完了で進捗監視を終える',async t=>{
 head(t);const fake=chromeApi(t),clock=progressClock(t),fractions=[],queries=[];let received=0;
 const search=fake.api.downloads.search;
 t.mock.method(fake.api.downloads,'search',async query=>{queries.push(query);return (await search(query)).map(item=>({...item,bytesReceived:received,totalBytes:bytes}));});
 const work=downloadManagedRecording({pageUrl},'meeting.mp4',new AbortController().signal,value=>fractions.push(value));await tick();
 for(const fraction of [.01,.5,.99,1]){received=bytes*fraction;await clock.step();}
 assert.equal(fractions.length,5);
 for(const [index,expected] of [0,.01,.5,.99,1].entries()) assert.ok(Math.abs(fractions[index]-expected)<1e-12);
 assert.ok(queries.every(query=>Object.keys(query).join()==='id'&&query.id===1));
 assert.equal(clock.timers.size,1);fake.finish(1,'complete');await work;
 assert.equal(clock.timers.size,0);assert.equal(fake.listeners.size,0);
});

for(const source of ['head','chrome','unknown'])test(`録画の総容量は実データを使い、不明なら時間で増やさない: ${source}`,async t=>{
 head(t,()=>new Response(null,{headers:{'content-type':'video/mp4',...(source==='head'?{'content-length':String(bytes)}:{})}}));
 const fake=chromeApi(t),clock=progressClock(t),fractions=[];const search=fake.api.downloads.search;
 t.mock.method(fake.api.downloads,'search',async query=>(await search(query)).map(item=>({...item,bytesReceived:bytes/2,totalBytes:source==='chrome'?bytes:-1})));
 const work=downloadManagedRecording({pageUrl},'meeting.mp4',new AbortController().signal,value=>fractions.push(value));await tick();await clock.step();
 assert.deepEqual(fractions,source==='unknown'?[]:[.5,.5]);fake.finish(1,'complete');await work;assert.equal(clock.timers.size,0);
});

for(const outcome of ['abort','interrupted','poll-error','late'])test(`転送進捗の監視と遅い応答を解放する: ${outcome}`,async t=>{
 head(t);const fake=chromeApi(t),clock=progressClock(t),fractions=[],controller=new AbortController();
 let calls=0,release;const search=fake.api.downloads.search;
 t.mock.method(fake.api.downloads,'search',async query=>{
  calls++;
  if(calls===2&&outcome==='poll-error')throw Error('query failed');
  if(calls===2&&outcome==='late')return new Promise(resolve=>release=()=>resolve([{id:1,state:'in_progress',bytesReceived:bytes/2,totalBytes:bytes}]));
  return (await search(query)).map(item=>({...item,bytesReceived:0,totalBytes:bytes}));
 });
 const work=downloadManagedRecording({pageUrl},'meeting.mp4',controller.signal,value=>fractions.push(value));const rejected=assert.rejects(work);await tick();
 if(outcome==='late'||outcome==='poll-error')await clock.step();
 if(outcome==='abort'||outcome==='late')controller.abort();
 if(outcome==='interrupted')fake.finish(1,'interrupted',{error:'NETWORK_FAILED'});
 await rejected;const before=fractions.length;if(release){release();await tick();}
 assert.equal(clock.timers.size,0);assert.equal(fake.listeners.size,0);assert.equal(fractions.length,before);
});

test('複数録画の転送と保存済み件数を合算し、中止後は未保存分だけ再試行する',async t=>{
 head(t);const fake=chromeApi(t),clock=progressClock(t),received=new Map(),updates=[];
 install(t,'document',{documentElement:{setAttribute(){}},body:{dataset:{}},querySelectorAll:()=>[]});
 const search=fake.api.downloads.search;t.mock.method(fake.api.downloads,'search',async query=>(await search(query)).map(item=>({...item,bytesReceived:received.get(query.id)??0,totalBytes:bytes})));
 const selected=[1,2].map(()=>({url,sourcePage:pageUrl,selected:true,kind:'video',stream:{pageUrl,bytes}}));let completed=0;
 const controller=createMixedExportController({getSelectedItems:()=>selected,getZipFilename:()=> 'meeting.zip',getPdfFilename:()=> 'meeting.pdf',isBusy:()=>false,isDisposed:()=>false,
  onBusyChange(){},onStatus(_message,state,progress){if(state==='busy')updates.push(progress);},onCloseViewer(){},onClearSourceUrl(){},onCompleted(){completed++;},onScrollToFailures(){}});
 const settings={imageFormat:'original',videoFormat:'original',includeSourcePage:false};
 let work=controller.export(settings);await tick();received.set(1,bytes/2);await clock.step();assert.equal(updates.at(-1),'25%');
 fake.finish(1,'complete');await tick();assert.equal(updates.at(-1),'50%');received.set(2,bytes/2);await clock.step();assert.equal(updates.at(-1),'75%');
 controller.abort();await work;assert.equal(clock.timers.size,0);assert.equal(completed,0);
 work=controller.export(settings);await tick();assert.equal(updates.at(-1),'50%');assert.equal(fake.starts.length,3);
 received.set(3,bytes);await clock.step();assert.equal(updates.at(-1),'99%');assert.equal(completed,0);
 fake.finish(3,'complete');await work;assert.equal(completed,1);assert.equal(clock.timers.size,0);assert.ok(updates.every(value=>parseInt(value)<100));
});
