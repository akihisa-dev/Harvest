import {tmpdir} from "node:os";
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {createHash, X509Certificate} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve, join} from 'node:path';
import {launchExtensionContext, temporaryDirectory} from './browser.mjs';
import {resourcesFor} from './resources.mjs';
import {key, cert} from './stream-tls.mjs';
import {redPng} from '../animation-fixtures.mjs';
import {mp4Bytes, fragmentedMp4} from '../media-fixtures.mjs';

/** A local HTTPS site, including auth and binary download, with no replaced Chrome APIs. */
export async function streamSite(t) {
  const host = 'harvest-fixture.sharepoint.com';
  const recording = Buffer.alloc(65 * 1024 ** 2);
  recording.set(mp4Bytes);recording.writeUInt32BE(recording.length - mp4Bytes.length, mp4Bytes.length);recording.write('free', mp4Bytes.length + 4);
  const requests = [], sockets = new Set();
  let permission = 'allowed', savedFilename;
  const server = createServer({key, cert}, (request, response) => {
    const url = new URL(request.url, `https://${host}`);
    const authenticated = (request.headers.cookie ?? '').split(';').some(value => value.trim() === 'fixtureSession=signed-in');
    requests.push({path: url.pathname, query: url.search, method: request.method, authenticated});
    if (url.pathname === '/login') {
      response.writeHead(200, {'content-type': 'text/html', 'set-cookie': 'fixtureSession=signed-in; Secure; HttpOnly; SameSite=Lax; Path=/'});
      response.end('<title>Fixture sign-in</title><p>Local synthetic session</p>');return;
    }
    if (url.pathname === '/login-required') {response.writeHead(200, {'content-type': 'text/html'});response.end('<title>Sign in required</title>');return;}
    if (!authenticated) {response.writeHead(302, {location: '/login-required'});response.end();return;}
    if (url.pathname === '/saved.mp4' && savedFilename) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), recording.length - 1) : recording.length - 1;
      if (start > end || start >= recording.length) {response.writeHead(416, {'content-range': `bytes */${recording.length}`});response.end();return;}
      response.writeHead(range ? 206 : 200, {'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': String(end - start + 1),
        ...(range ? {'content-range': `bytes ${start}-${end}/${recording.length}`} : {})});
      const stream = createReadStream(savedFilename, {start, end});
      stream.on('error', () => response.destroy());response.on('close', () => stream.destroy());stream.pipe(response);return;
    }
    if (url.pathname.endsWith('/download.aspx')) {
      if (permission === 'denied') {response.writeHead(403);response.end('Download blocked');return;}
      if (permission === 'expired') {response.writeHead(302, {location: '/login-required'});response.end();return;}
      const source = url.searchParams.get('SourceUrl');
      if (source !== `https://${host}/sites/team/Documents/Recordings/meeting.mp4`) {response.writeHead(404);response.end('Wrong recording');return;}
      response.writeHead(200, {'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="meeting.mp4"', 'content-length': String(recording.length)});
      response.end(request.method === 'HEAD' ? undefined : recording);return;
    }
    if (/\/thumb\d\.png$/.test(url.pathname)) {response.writeHead(200, {'content-type': 'image/png'});response.end(redPng);return;}
    if (url.pathname === '/playback-segment') {response.writeHead(200, {'content-type': 'video/mp4'});response.end(fragmentedMp4);return;}
    // A typical MSE player exposes a blob URL rather than the original MP4 URL.
    const html = `<title>仮想Stream 会議録画</title><h1>会議録画</h1><video controls poster="/thumb1.png"></video>
      <img src="/thumb2.png" width="120" height="80"><img src="/thumb3.png" width="120" height="80">
      <script>
        const video=document.querySelector('video'), media=new MediaSource();video.src=URL.createObjectURL(media);
        media.addEventListener('sourceopen',async()=>{
          const buffer=media.addSourceBuffer('video/mp4; codecs="avc1.640001"');
          buffer.addEventListener('updateend',()=>{media.endOfStream();video.dataset.ready='true';},{once:true});
          buffer.appendBuffer(await (await fetch('/playback-segment')).arrayBuffer());
        },{once:true});
      </script>`;
    response.writeHead(200, {'content-type': 'text/html'});response.end(html);
  });
  server.on('connection', socket => {sockets.add(socket);socket.on('close', () => sockets.delete(socket));});
  resourcesFor(t).defer(() => new Promise((resolve, reject) => {
    server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
    for (const socket of sockets) socket.destroy();
  }));
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
  const temporary = await temporaryDirectory(t, join(tmpdir(), 'harvest-stream-site-'));
  await mkdir(`${temporary}/profile/Default`, {recursive: true});await mkdir(`${temporary}/downloads`);
  await writeFile(`${temporary}/profile/Default/Preferences`, JSON.stringify({download: {default_directory: `${temporary}/downloads`, prompt_for_download: false}}));
  const spki = createHash('sha256').update(new X509Certificate(cert).publicKey.export({format: 'der', type: 'spki'})).digest('base64');
  const context = await launchExtensionContext(t, `${temporary}/profile`, {locale: 'ja-JP', reducedMotion: 'reduce',
    args: ['--enable-unsafe-extension-debugging', '--disable-background-networking', '--no-first-run', '--no-proxy-server',
      // Only this test server models a public site; product network checks remain enabled.
      `--ip-address-space-overrides=127.0.0.1:${server.address().port}=public`,
      `--ignore-certificate-errors-spki-list=${spki}`, `--host-resolver-rules=MAP ${host} 127.0.0.1:${server.address().port}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`]});
  const cdp = await context.browser().newBrowserCDPSession();
  const {id} = await cdp.send('Extensions.loadUnpacked', {path: resolve('dist/extension')});
  await cdp.send('Browser.setDownloadBehavior', {behavior: 'default'});
  const errors = [], networkErrors = [], panel = await context.newPage(), playback = await context.newPage();
  panel.on('requestfailed', request => networkErrors.push({url: request.url(), error: request.failure()?.errorText}));
  panel.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await playback.goto(`https://${host}/login`);
  assert.match(await playback.title(), /Fixture sign-in/);
  await panel.goto(`chrome-extension://${id}/app/index.html`);
  await panel.evaluate(() => {window.downloadIds=[];chrome.downloads.onCreated.addListener(item => window.downloadIds.push(item.id));});
  const path = '/sites/team/Documents/Recordings/meeting.mp4';
  const pages = {
    stream: `https://${host}/sites/team/_layouts/15/stream.aspx?id=${encodeURIComponent(path)}`,
    library: `https://${host}/sites/team/Documents/Forms/AllItems.aspx?id=${encodeURIComponent(path)}&parent=${encodeURIComponent('/sites/team/Documents/Recordings')}`,
  };
  async function scan(kind, current = false) {
    await playback.goto(pages[kind]);
    await playback.waitForFunction(() => document.querySelector('video')?.src.startsWith('blob:') && document.querySelector('video').dataset.ready === 'true');
    if (current) {
      await playback.bringToFront();
      // Keep the real playback tab active, as it would be beside Chrome's side panel.
      await panel.evaluate(() => document.querySelector('#scan').click());
    } else {
      await panel.locator('#source-drop').click();await panel.locator('#source-url').fill(pages[kind]);
      await panel.locator('#scan').click();
    }
    await panel.waitForFunction(() => document.querySelector('#scan').dataset.scanning === 'false' && !document.querySelector('#scan').disabled);
    return panel.locator('#images').innerText();
  }
  async function playSaved(filename) {
    assert.ok(resolve(filename).startsWith(resolve(temporary, 'downloads') + '/'));
    savedFilename = filename;
    return playback.evaluate(async () => {
      const video = document.querySelector('video');
      video.muted = true;video.src = '/saved.mp4';
      const ended = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Saved recording did not play to the end')), 15_000);
        video.addEventListener('ended', () => {clearTimeout(timer);resolve({ended: video.ended, duration: video.duration, currentTime: video.currentTime});}, {once: true});
        video.addEventListener('error', () => {clearTimeout(timer);reject(new Error('Saved recording decode failed'));}, {once: true});
      });
      await video.play();return ended;
    });
  }
  return {panel, playback, scan, pages, requests, recording, networkErrors, playSaved, permission(value) {permission=value;}};
}
