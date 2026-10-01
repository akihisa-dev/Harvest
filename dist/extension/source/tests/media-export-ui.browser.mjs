import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {chromium} from 'playwright';

let png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const mp4 = Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,49]);

test('画像の形式を保ち、MP4とGIFだけを各形式のZIPへ保存する', async () => {
  const root = resolve('dist/extension');
  const server = createServer(async (req,res) => {
    try {
      const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!path.startsWith(root + sep)) throw new Error();
      const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json'};
      res.setHeader('content-type', mime[extname(path)] ?? 'application/octet-stream');
      res.end(await readFile(path));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({channel:'chrome',headless:true});
    const context = await browser.newContext({locale:'ja-JP',reducedMotion:'reduce',acceptDownloads:true});
    await context.addInitScript(() => {
      window.chrome = {
        runtime:{onConnect:{addListener(){}}},i18n:{getUILanguage:()=> 'ja'},
        tabs:{query:async()=>[{id:7,url:'https://source.example.test/gallery'}],get:async()=>({id:7,url:'https://source.example.test/gallery'}),onRemoved:{addListener(){},removeListener(){}}},
        scripting:{executeScript:async()=>[{result:window.fixture}]},
      };
    });
    await context.route('https://files.example.test/**', route => {
      const url = route.request().url();
      const body = url.endsWith('.gif') ? gif : url.endsWith('.mp4') ? mp4 : png;
      const contentType = url.endsWith('.gif') ? 'image/gif' : url.endsWith('.mp4') ? 'video/mp4' : 'image/png';
      return route.fulfill({status:200,contentType,body,headers:{'access-control-allow-origin':'*'}});
    });
    const page = await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width:768,height:600});
    await page.goto(`http://127.0.0.1:${server.address().port}/app/index.html`);
    png = Buffer.from(await page.evaluate(() => {
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=960;
      canvas.getContext('2d').fillRect(0,0,640,960);
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');
    const scan = async (images, media=[]) => {
      await page.evaluate(({images,media})=> {window.fixture={url:'https://source.example.test/gallery',title:'media',images,media};}, {images,media});
      await page.locator('#scan').click();
      await page.waitForFunction(()=>!document.querySelector('#scan').disabled);
    };
    const photo='https://files.example.test/photo.png';
    const animation='https://files.example.test/animation.gif';
    const movie='https://files.example.test/movie.mp4';
    await scan([photo]);
    await page.waitForFunction(() => document.querySelector('#images .item-resolution')?.textContent === '640 × 960');
    assert.equal(await page.locator('#images .item-resolution').isVisible(),true);
    const captionPosition=await page.locator('#images > li').first().evaluate(row => {
      const resolution=row.querySelector('.item-resolution').getBoundingClientRect();
      const name=document.createRange();name.selectNodeContents(row.querySelector('.item-title'));
      return resolution.bottom < name.getBoundingClientRect().top;
    });
    assert.equal(captionPosition,true,'解像度はファイル名の文字の上へ重ねる');
    assert.equal(await page.locator('#export-format-pdf').isChecked(),true);
    assert.equal(await page.locator('#export-format-jxl').isVisible(),true);
    assert.equal(await page.locator('#export-format-mp4').isVisible(),false);
    assert.equal(await page.locator('#export-format-gif').isVisible(),false);
    assert.equal(await page.locator('#export-format-original').count(),0);
    await scan([photo,animation],[{url:animation,kind:'gif'},{url:movie,kind:'video'}]);
    assert.equal(await page.locator('#export-format-mp4').isChecked(),true);
    const groups=page.locator('#groups .group-label');
    assert.deepEqual(await groups.allTextContents(),['MP4\n(1件)','GIF\n(1件)','PNG · その他\n(1枚)']);
    const gifGroup=page.locator('#groups .group-chip').filter({hasText:'GIF'});
    await gifGroup.locator('input').check();
    assert.equal(await gifGroup.locator('input').isChecked(),true);
    await gifGroup.locator('button').click();
    assert.equal(await page.locator('#images > li').count(),2,'GIFだけの表示切替を動画とは独立に行う');
    await page.locator('#all-selection').check();
    await page.locator('#export-format-pdf').check();
    assert.match(await page.locator('#export-media-hint').textContent(),/選択中の2件は対象外/);
    assert.equal(await page.locator('#export').isDisabled(),false);
    await page.locator('#export-format-mp4').check();
    const save = async format => {
      await page.locator(`#export-format-${format}`).check();
      const downloadPromise=page.waitForEvent('download');
      await page.locator('#export').click();
      const download=await downloadPromise;
      assert.equal(download.suggestedFilename(),'media.zip');
      const bytes=await readFile(await download.path());
      const entries=[];let offset=0;
      while(bytes.readUInt32LE(offset)===0x04034b50){
        const size=bytes.readUInt32LE(offset+22),nameLength=bytes.readUInt16LE(offset+26);
        const start=offset+30+nameLength;
        entries.push({name:bytes.subarray(offset+30,start).toString(),data:bytes.subarray(start,start+size)});
        offset=start+size;
      }
      return entries;
    };
    const videos=await save('mp4');
    assert.deepEqual(videos.map(e=>e.name),['001.mp4']);
    assert.deepEqual(videos[0].data,mp4);
    const gifs=await save('gif');
    assert.deepEqual(gifs.map(e=>e.name),['001.gif']);
    assert.deepEqual(gifs[0].data,gif);
    const images=await save('png');
    assert.deepEqual(images.map(e=>e.name),['001.png']);
    assert.deepEqual(images[0].data,png);
    await scan([],[{url:movie,kind:'video'}]);
    assert.equal(await page.locator('#export-format-mp4').isChecked(),true);
    for(const format of ['pdf','jpg','png','jxl']) assert.equal(await page.locator(`#export-format-${format}`).isVisible(),false);
    assert.equal(await page.locator('#export').isDisabled(),false);
    assert.equal(await page.locator('#export-format-gif').isVisible(),false);
    assert.equal(await page.locator('#images .item-resolution').isVisible(),false,'動画の代替画像を動画の解像度として表示しない');
    assert.match(await page.locator('#export').textContent(),/MP4/);
    await scan([animation],[{url:animation,kind:'gif'}]);
    assert.equal(await page.locator('#export-format-gif').isChecked(),true);
    assert.equal(await page.locator('#export-format-mp4').isVisible(),false);
    assert.match(await page.locator('#export').textContent(),/GIF/);
    await scan([photo,animation],[{url:animation,kind:'gif'},{url:movie,kind:'video'}]);
    await page.locator('#all-selection').check();
    await page.locator('#all-visibility').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('#images > li img')].slice(0,2).every(image=>image.complete && image.naturalWidth>0));
    assert.deepEqual(await page.locator('#images .item-resolution').allTextContents(),['640 × 960','1 × 1','']);
    await page.screenshot({path:'/private/tmp/harvest-media-ui.png'});
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
