import test from "node:test";
import assert from "node:assert/strict";
import {serveExtension, extensionFile} from "./support/extension-files.mjs";
import {launchBrowser} from "./support/browser.mjs";
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+ioAAAAASUVORK5CYII=","base64");
for(const count of [200,1000]) test(`each actual application render classifies the selection once (${count})`,async t=>{
  const {url}=await serveExtension(t),browser=await launchBrowser(t),page=await browser.newPage({viewport:{width:1220,height:800}});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  // Instrument served module functions, leaving product files and their behavior unchanged.
  await page.route("**/core/export-recommendations.js",async route=>{
    const file=await extensionFile(new URL(route.request().url()).pathname);
    const body=file.body.toString().replace("function imageRecommendations(selected) {","function imageRecommendations(selected) { globalThis.classifications++; ");
    await route.fulfill({contentType:file.contentType,body});
  });
  await page.route("**/app/panel/application.js",async route=>{
    const file=await extensionFile(new URL(route.request().url()).pathname);
    const body=file.body.toString().replace("function render() {","function render() { const classificationStart=globalThis.classifications;")
      .replace("renderSnapshot = previousSnapshot;","renderSnapshot = previousSnapshot; globalThis.renderClassifications.push(globalThis.classifications-classificationStart);");
    await route.fulfill({contentType:file.contentType,body});
  });
  await page.addInitScript(count=>{
    globalThis.classifications=0;globalThis.renderClassifications=[];
    localStorage.setItem("harvest.includeSourcePage","true");
    window.chrome={runtime:{onConnect:{addListener(){}}},i18n:{getUILanguage:()=>"ja-JP"},
      tabs:{query:async()=>[{id:7,url:"https://source.example.test/gallery"}],get:async()=>({id:7,url:"https://source.example.test/gallery"}),onRemoved:{addListener(){},removeListener(){}}},
      scripting:{executeScript:async()=>[{result:{images:Array.from({length:count},(_,i)=>`https://images.example.test/pages/${i}.jpg`),url:"https://source.example.test/gallery",title:"Render snapshot"}}]}};
  },count);
  await page.route("https://images.example.test/**",route=>route.fulfill({contentType:"image/png",body:png}));
  await page.goto(url);await page.locator("#scan").click();
  await page.waitForFunction(count=>document.querySelector("#images").children.length>=count,count);
  await page.waitForTimeout(350);
  for(const selector of ["#images > li:first-child","#images > li:first-child","#viewer-toggle","#viewer-toggle","#export-format-png","#export-format-recommend"]){
    await page.evaluate(()=>{globalThis.renderClassifications=[];});
    await page.locator(selector).click();
    const counts=await page.evaluate(()=>globalThis.renderClassifications);
    assert.ok(counts.length>0,`actual render reached from ${selector}`);
    assert.ok(counts.every(value=>value===1),`${selector}: ${counts}`);
    await page.waitForTimeout(350);
  }
  await page.locator("#viewer-toggle").click();
  for(const direction of ["next","previous","next","previous"]){
    await page.evaluate(()=>{globalThis.classifications=0;globalThis.renderClassifications=[];});
    await page.locator(`#viewer-${direction}`).click();
    assert.equal(await page.evaluate(()=>globalThis.classifications),1,"navigation classifies one fresh selection snapshot");
    assert.equal(await page.evaluate(()=>globalThis.renderClassifications.length),0,"viewer navigation stays in its existing controller path");
    assert.equal(await page.locator(`#viewer-${direction}`).evaluate(button=>document.activeElement===button),true);
    await page.waitForTimeout(350);
  }
  assert.equal(await page.locator("#export-format-recommend").isChecked(),true);
  assert.deepEqual(errors,[]);
});
