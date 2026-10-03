import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {chromium} from 'playwright';

test('画像とSourceの登場途中の削除は現在の濃さを保って退出し、複製を解放する', async () => {
  const root = resolve('dist/extension');
  const server = createServer(async (req, res) => {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end('<style>li{height:80px;width:200px;background:red}#images{display:flex;flex-direction:column}</style><button id="all"></button><div id="groups"></div><ol id="images"></ol>');
      return;
    }
    try {
      const path = resolve(root, '.' + req.url);
      if (!path.startsWith(root + sep)) throw Error();
      res.setHeader('content-type', 'text/javascript');
      res.end(await readFile(path));
    }
    catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome', headless: true});
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const {ImageCollection} = await import('/core/image-collection.js');
      const {createImageListView} = await import('/app/panel/image-list-view.js');
      const collection = new ImageCollection();
      collection.replace(['https://example.test/1.jpg'], 'https://example.test/');
      const imagesElement = document.querySelector('#images');
      const view = createImageListView({
        collection,
        imagesElement,
        groupsElement: document.querySelector('#groups'),
        allVisibilityButton: document.querySelector('#all'),
        isBusy: () => false,
        getFilename: () => 'image',
        previewLoader: {set() {}, clearImage() {} },
        onChange: () => view.render()
      });
      window.fixture = {view, imagesElement, source: {url: 'data:image/svg+xml,source', sourcePage: 'https://example.test/', selected: true}};
      view.showInitialGroup(null);
      view.render();
      document.getAnimations().forEach(animation => animation.finish());
    });
    for (const kind of ['source', 'group'])
      for (const time of [10, 240]) {
        const result = await page.evaluate(({kind, time}) => {
          const {view, source, imagesElement} = window.fixture;
          if (kind === 'source') view.render(new Set(), source);
          else {
            document.querySelector('#all').click();
            document.querySelector('#all').click();
          }
          const row = kind === 'source' ? imagesElement.querySelector('.source-preview') : imagesElement.firstElementChild;
          for (const animation of row.getAnimations()) {
            animation.pause();
            animation.currentTime = time;
          }
          const before = Number(getComputedStyle(row).opacity);
          if (kind === 'source') view.render(new Set(), null);
          else document.querySelector('#all').click();
          const ghosts = [...document.querySelectorAll('.motion-ghost')];
          const ghost = ghosts.filter(element => kind === 'source' ? element.classList.contains('source-preview') : !element.classList.contains('source-preview')).at(-1);
          const animation = ghost.getAnimations()[0];
          animation.pause();
          animation.currentTime = 0;
          const result = {
            before,
            after: Number(getComputedStyle(ghost).opacity),
            inert: ghost.inert,
            hidden: ghost.getAttribute('aria-hidden'),
            pointer: getComputedStyle(ghost).pointerEvents
          };
          document.getAnimations().forEach(animation => animation.finish());
          return result;
        }, {kind, time});
        assert.ok(Math.abs(result.before - result.after) < 0.001, JSON.stringify({kind, time, ...result}));
        assert.equal(result.inert, true);
        assert.equal(result.hidden, 'true');
        assert.equal(result.pointer, 'none');
        await page.waitForFunction(() => document.querySelectorAll('.motion-ghost-shell').length === 0);
        if (kind === 'group') await page.locator('#all').click();
        await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
      }
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.evaluate(() => {
      const {view, source} = window.fixture;
      view.render(new Set(), source);
      view.render(new Set(), null);
      document.querySelector('#all').click();
    });
    assert.equal(await page.locator('.motion-ghost-shell').count(), 0);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
