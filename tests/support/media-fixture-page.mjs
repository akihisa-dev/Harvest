import {readFile} from "node:fs/promises";
import {resourcesFor} from "./resources.mjs";

// Generate and independently inspect fixtures with the unchanged upstream bundle.
// Product pages and Workers always load the reduced distribution bundle.
export async function mediaFixturePage(t, productPage) {
  const bundle = await readFile(new URL("../../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs", import.meta.url));
  // Fulfill before DNS/network access, including in contexts that block every host.
  const origin = "https://media-fixtures.harvest.test";
  const context = productPage.context();
  const route = route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/mediabunny.js") return route.fulfill({contentType: "text/javascript", body: bundle});
    if (path === "/") return route.fulfill({contentType: "text/html", body: "<title>Media test fixtures</title>"});
    return route.fulfill({status: 404, body: "Not found"});
  };
  await context.route(`${origin}/**`, route);
  resourcesFor(t).defer(() => context.unroute(`${origin}/**`, route));
  const page = await resourcesFor(t).acquire(() => context.newPage(), page => page.close());
  await page.goto(origin);
  return page;
}
