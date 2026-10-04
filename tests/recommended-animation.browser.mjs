import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {temporaryDirectory,launchExtensionContext,startServer} from './support/browser.mjs';
import {staticWebp,apng,animatedGif} from './animation-fixtures.mjs';

export async function animationPanel(t, assets) {
  let paths = [], name = 'animation', requests = [];
  const server = await startServer(t, (request,response) => {
    const path = new URL(request.url,'http://localhost').pathname;
    if (path === '/gallery') { response.writeHead(200,{'content-type':'text/html'});response.end(`<title>${name}</title>${paths.map(path => `<img width="32" height="24" src="${path}">`).join('')}`);return; }
    const [body,type] = assets.get(path) ?? [Buffer.from('missing'),'text/plain'];
    requests.push(path); response.writeHead(200,{'content-type':type,'content-length':String(body.length)});response.end(request.method === 'HEAD' ? '' : body);
  });
  const origin = `http://127.0.0.1:${server.address().port}`, temporary = await temporaryDirectory(t,'/tmp/harvest-recommended-animation-');
  await mkdir(`${temporary}/profile/Default`,{recursive:true});await mkdir(`${temporary}/downloads`);
  await writeFile(`${temporary}/profile/Default/Preferences`,JSON.stringify({download:{default_directory:`${temporary}/downloads`,prompt_for_download:false}}));
  const context = await launchExtensionContext(t,`${temporary}/profile`,{locale:'ja-JP',reducedMotion:'reduce',args:['--enable-unsafe-extension-debugging','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--no-first-run']});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());return ['http:','https:'].includes(url.protocol) && url.origin !== origin ? route.abort('blockedbyclient') : route.continue();
  });
  const cdp = await context.browser().newBrowserCDPSession();const {id} = await cdp.send('Extensions.loadUnpacked',{path:resolve('dist/extension')});await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});
  const page = await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));
  await page.goto(`chrome-extension://${id}/app/index.html`);await page.evaluate(()=>{window.downloadIds=[];chrome.downloads.onCreated.addListener(item=>window.downloadIds.push(item.id));});
  const count = () => page.evaluate(()=>window.downloadIds.length);
  const scan = async (nextPaths,nextName='animation') => {
    paths=nextPaths;name=nextName;requests=[];await page.locator('#source-drop').click();await page.locator('#source-url').fill(`${origin}/gallery`);await page.locator('#scan').click();await page.waitForFunction(()=>document.querySelector('#scan').dataset.scanning==='false'&&!document.querySelector('#scan').disabled);await page.locator('#all-selection').check();
  };
  const saved = async (format) => {
    await page.locator(`#export-format-${format}`).check();const before=await count();await page.locator('#export').click();await page.waitForFunction(before=>window.downloadIds.length===before+1,before);await page.waitForFunction(async()=> (await chrome.downloads.search({id:window.downloadIds.at(-1)}))[0]?.state==='complete');await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='success');const download=await page.evaluate(async()=> (await chrome.downloads.search({id:window.downloadIds.at(-1)}))[0]);return {bytes:await readFile(download.filename),filename:download.filename};
  };
  const failed = async () => {
    const before=await count();await page.locator('#export').click();await page.waitForFunction(()=>document.querySelector('#export').dataset.saving==='false'&&document.querySelector('#images .failed'));assert.equal(await count(),before);assert.notEqual(await page.locator('#status').getAttribute('data-state'),'success');return page.locator('#failures').innerText();
  };
  return {page,scan,saved,failed,count,requests:()=>requests};
}


function storedEntries(bytes) {
  const entries=[];
  for(let offset=0;bytes.readUInt32LE(offset)===0x04034b50;){
    const size=bytes.readUInt32LE(offset+22), start=offset+30+bytes.readUInt16LE(offset+26);
    entries.push({name:bytes.subarray(offset+30,start).toString(),bytes:bytes.subarray(start,start+size)});offset=start+size;
  }
  return entries;
}
test('拡張子なしGIFを実レスポンスで確認し、推奨単体/選択順ZIP・表示・再試行で原本保持する', {timeout:90_000}, async t => {
  const assets=new Map([['/unknown',[animatedGif,'image/gif']],['/animation.gif',[animatedGif,'image/gif']],['/static.webp',[staticWebp,'image/webp']],['/apng.png',[apng,'image/png']]]);
  const {page,scan,saved,failed,count}=await animationPanel(t,assets);
  await scan(['/unknown']);assert.match(await page.locator('#images').innerText(),/unknown/);assert.doesNotMatch(await page.locator('#images').innerText(),/GIF ·/);
  const single=await saved('recommend');assert.match(single.filename,/\.gif$/);assert.deepEqual(single.bytes,animatedGif);
  assert.equal(await page.locator('#export-recommend-extension').textContent(),'(GIF)');
  assert.deepEqual((await saved('original')).bytes,animatedGif);
  await scan(['/unknown','/static.webp','/animation.gif','/apng.png']);await page.locator('#groups .group-chip').filter({hasText:'PNG'}).locator('button').click();await page.locator('#images > li[data-focus-url$="/apng.png"]').click();
  const entries=storedEntries((await saved('recommend')).bytes);assert.deepEqual(entries.map(entry=>entry.name),['001.gif','002.png','003.gif']);assert.deepEqual(entries[0].bytes,animatedGif);assert.deepEqual(entries[2].bytes,animatedGif);
  for(const [body,type] of [[animatedGif,'image/png'],[staticWebp,'image/gif'],[animatedGif.subarray(0,animatedGif.length-1),'image/gif']]){
    assets.set('/unknown',[body,type]);await scan(['/unknown','/static.webp']);await page.locator('#export-format-recommend').check();assert.match(await failed(),/一致しません|不完全|破損/);
    assets.set('/unknown',[animatedGif,'image/gif']);const retry=storedEntries((await saved('recommend')).bytes);assert.deepEqual(retry[0].bytes,animatedGif);assert.equal(retry[0].name,'001.gif');
  }
  await scan(['/unknown']);assert.match((await saved('png')).filename,/\.png$/);assert.deepEqual((await saved('recommend')).bytes,animatedGif);
  const before=await count();await page.evaluate(()=>{document.querySelector('#export').click();document.querySelector('#export').click();});await page.waitForFunction(()=>document.querySelector('#export').dataset.saving==='false');assert.equal(await count(),before);
});
