// Screenshots of the shop and a battle for eyeballing art changes. Usage: node e2e/shot.mjs <outdir>
import { launch, pageUrl, serve, setBase } from "./pw.mjs";
const out = process.argv[2] || ".";
const server = await serve();
setBase(`http://127.0.0.1:${server.address().port}`);
const browser = await launch();
try {
  for (const vp of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 420, height: 860 }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(pageUrl("?shop=1"));
    await page.click('[data-slot="1"][data-kind="cpu"]');
    await page.click("#start");
    await page.click("#to-shop");
    await page.evaluate(() => { window.__fm.match.players[0].cash = 400; });
    await page.click('[data-buy="shovel"]');
    await page.screenshot({ path: `${out}/shop-${vp.width}.png` });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
