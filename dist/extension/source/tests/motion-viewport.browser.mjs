import test from "node:test";
import assert from "node:assert/strict";
import {extensionFile} from "./support/extension-files.mjs";
import {launchBrowser,startServer} from "./support/browser.mjs";
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=","base64");
for(const count of [200,1000]) test(`ordered list motion measures visible rows and retains exit previews (${count})`,async t=>{
  const server=await startServer(t,async(request,response)=>{
    const path=new URL(request.url,"http://localhost").pathname;
    if(path==="/fixture.html"){
      response.writeHead(200,{"content-type":"text/html"});
      response.end(`<!doctype html><html><head><title>Harvest viewport motion fixture</title><link rel="stylesheet" href="/app/style.css"></head>
        <body data-fixture="viewport-motion"><button id="all"></button><div id="groups"></div><main style="display:block; height:580px; max-height:calc(100vh - 100px); width:min(900px, calc(100vw - 32px)); overflow:auto"><ol id="images" class="image-list"></ol></main>
        <script type="module">
          import {ImageCollection} from '/core/image-collection.js';
          import {createImageListView} from '/app/panel/image-list-view.js';
          import {createImagePreviewLoader} from '/app/media/image-preview.js';
          const collection=new ImageCollection();
          collection.replace(Array.from({length:${count}},(_,i)=>'https://images.example.test/set/page-'+i+'.jpg'),'https://source.example.test/');
          const previews=createImagePreviewLoader(),images=document.querySelector('#images');
          const view=createImageListView({collection,imagesElement:images,groupsElement:document.querySelector('#groups'),allVisibilityButton:document.querySelector('#all'),isBusy:()=>false,getFilename:url=>url.split('/').pop(),previewLoader:previews,onChange:()=>view.render()});
          const counters={rects:0,clones:0,removed:0};
          new MutationObserver(records=>{for(const record of records)counters.removed+=record.removedNodes.length}).observe(images,{childList:true});
          const rect=Element.prototype.getBoundingClientRect,clone=Node.prototype.cloneNode,revoke=URL.revokeObjectURL;
          Element.prototype.getBoundingClientRect=function(){if(this.parentElement===images)counters.rects++;return rect.call(this)};
          Node.prototype.cloneNode=function(deep){if(this.parentElement===images)counters.clones++;return clone.call(this,deep)};
          const revoked=[];URL.revokeObjectURL=url=>{revoked.push(url);return revoke(url)};
          window.fixture={collection,previews,view,counters,revoked,reset(){counters.rects=0;counters.clones=0;counters.removed=0}};
          view.showInitialGroup(null);view.render();
        </script></body></html>`);return;
    }
    try{const file=await extensionFile(path);response.writeHead(200,{"content-type":file.contentType});response.end(file.body)}catch{response.writeHead(404).end()}
  });
  const browser=await launchBrowser(t),page=await browser.newPage({viewport:{width:1220,height:800},reducedMotion:"no-preference"});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>{window.previewErrors=0;document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement)window.previewErrors++},true)});
  await page.route("https://images.example.test/**",route=>route.fulfill({contentType:"image/png",body:png}));
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture.html`);
  await page.waitForFunction(()=>Boolean(window.fixture));await page.waitForTimeout(350);
  await page.waitForFunction(()=>{
    const bounds=document.querySelector('main').getBoundingClientRect();
    return [...document.querySelectorAll('#images img')].filter(image=>{const rect=image.closest('li').getBoundingClientRect();return rect.bottom>bounds.top&&rect.top<bounds.bottom}).every(image=>image.complete&&image.naturalWidth>0);
  });
  const visibleCount=await page.evaluate(()=>{const main=document.querySelector('main').getBoundingClientRect();return [...document.querySelector('#images').children].filter(row=>{const r=row.getBoundingClientRect();return r.bottom>main.top&&r.top<main.bottom&&r.top<innerHeight}).length});
  await page.evaluate(()=>{window.originalRows=[...document.querySelector('#images').children];fixture.reset()});await page.locator('#all').click();
  const exit=await page.evaluate(()=>{
    const ghosts=[...document.querySelectorAll('.motion-ghost')];
    for(const ghost of ghosts)for(const animation of ghost.getAnimations())animation.pause();
    return {...fixture.counters,ghosts:ghosts.length,ready:fixture.previews.diagnostics.ready,urls:ghosts.map(ghost=>ghost.querySelector('img')?.src).filter(Boolean)};
  });
  assert.equal(exit.ghosts,visibleCount);assert.equal(exit.clones,visibleCount);
  assert.ok(exit.rects<=visibleCount+16,JSON.stringify(exit));assert.ok(exit.ready>0);
  assert.ok(exit.urls.every(url=>url.startsWith('blob:')));
  assert.equal(await page.locator('#images > li').count(),0);
  await page.waitForFunction(()=>[...document.querySelectorAll('.motion-ghost img')].every(image=>image.complete&&image.naturalWidth>0));
  assert.equal(await page.evaluate(urls=>urls.some(url=>fixture.revoked.includes(url)),exit.urls),false,"visible exit keeps the Blob references alive");
  await page.screenshot({path:`/tmp/harvest-129-ghost-${count}.png`});
  await page.evaluate(()=>{for(const ghost of document.querySelectorAll('.motion-ghost'))for(const animation of ghost.getAnimations())animation.finish()});
  await page.waitForFunction(()=>document.querySelectorAll('.motion-ghost-shell').length===0);
  assert.equal(await page.evaluate(()=>fixture.previews.diagnostics.bound),0);
  assert.equal(await page.evaluate(urls=>urls.every(url=>fixture.revoked.includes(url)),exit.urls),true,"exit completion releases Blob references");
  await page.locator('#all').click();await page.waitForTimeout(350);
  await page.waitForFunction(()=>document.querySelector('#images img').dataset.previewUrl&&document.querySelector('#images img').src.startsWith('blob:')&&document.querySelector('#images img').naturalWidth>0);
  assert.equal(await page.evaluate(()=>originalRows.every((row,index)=>document.querySelector('#images').children[index]===row)),true,"same result reuses released row templates");
  const first=page.locator('#images > li').first(),second=page.locator('#images > li').nth(1);
  const firstUrl=await first.getAttribute('data-focus-url');
  const targetBox=await second.boundingBox();
  await page.evaluate(()=>fixture.reset());await first.dragTo(second,{targetPosition:{x:targetBox.width*.8,y:targetBox.height/2}});
  const drop=await page.evaluate(url=>({rects:fixture.counters.rects,removed:fixture.counters.removed,first:fixture.collection.items[0].url,second:fixture.collection.items[1].url,focus:document.activeElement?.dataset.focusUrl,selected:fixture.collection.items.every(item=>item.selected)}),firstUrl);
  assert.equal(drop.second,firstUrl);assert.equal(drop.focus,firstUrl);assert.equal(drop.selected,true);
  assert.ok(drop.rects<count+120,JSON.stringify(drop));
  assert.ok(drop.removed<=2,"near reorder retains unaffected DOM rows");
  await page.waitForTimeout(350);await page.locator('main').evaluate(element=>element.scrollTop=element.scrollHeight/2);
  await page.setViewportSize({width:760,height:650});await page.waitForTimeout(350);
  await page.evaluate(()=>fixture.reset());await page.locator('#all').click();
  const scrolled=await page.evaluate(()=>({...fixture.counters,ghosts:document.querySelectorAll('.motion-ghost').length}));
  assert.ok(scrolled.ghosts>0&&scrolled.ghosts<40,JSON.stringify(scrolled));assert.equal(scrolled.clones,scrolled.ghosts);
  await page.waitForFunction(()=>document.querySelectorAll('.motion-ghost-shell').length===0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>fixture.reset());
  await page.locator('#all').click();await page.locator('#all').click();
  assert.equal(await page.locator('.motion-ghost-shell').count(),0);
  assert.equal(await page.evaluate(()=>fixture.counters.rects),0);
  await page.evaluate(()=>{
    fixture.collection.replace(['https://images.example.test/other/new.jpg'],'https://source.example.test/other');
    fixture.view.showInitialGroup(null);fixture.view.render();
  });
  await page.waitForFunction(()=>document.querySelector('#images img').naturalWidth>0);
  await page.evaluate(()=>{
    fixture.collection.replace([originalRows[0].dataset.focusUrl],'https://source.example.test/');
    fixture.view.showInitialGroup(null);fixture.view.render();
  });
  assert.equal(await page.evaluate(()=>originalRows[0]===document.querySelector('#images > li')),false,"another result removes obsolete cached templates");
  await page.waitForFunction(()=>document.querySelector('#images img').naturalWidth>0);
  await page.evaluate(()=>{fixture.collection.clear();fixture.view.clearVisibleGroups();fixture.view.render()});
  assert.equal(await page.locator('#images > li').count(),0);
  assert.equal(await page.evaluate(()=>fixture.previews.diagnostics.bound),0);
  assert.equal(await page.evaluate(()=>window.previewErrors),0);assert.deepEqual(errors,[]);
});
