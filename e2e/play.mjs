// Plays a full CPU-vs-CPU match in arcade, gunner, and observer, then checks that the
// setup, the gun, and the shop fit on screen at 1920x1080 and 1366x768.
// Usage: node e2e/play.mjs
import { launch, pageUrl, serve, setBase } from "./pw.mjs";

const server = await serve();
setBase(`http://127.0.0.1:${server.address().port}`);
const browser = await launch();
const errors = [];

function arm(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
}

async function offscreen(page) {
  return page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("button, input")) {
      if (el.closest("[hidden]")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) {
        bad.push((el.id || el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40));
      }
    }
    return bad;
  });
}

async function cpuMatch(mode) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  arm(page);
  await page.goto(pageUrl(`?test=1&seed=7`));
  await page.waitForSelector("#start");
  await page.click(`[data-mode="${mode}"]`);
  await page.click('[data-map="hills"]');
  await page.click('[data-rounds="3"]');
  await page.click('[data-slot="0"][data-kind="cpu"]');
  await page.click('[data-slot="0"][data-diff="hard"]');
  await page.click('[data-slot="1"][data-kind="cpu"]');
  await page.click('[data-slot="1"][data-diff="hard"]');
  await page.click("#start");
  await page.waitForSelector("#winner-name", { timeout: 20000 });
  const result = await page.evaluate(() => {
    const m = window.__fm.match;
    return {
      phase: m.phase,
      mode: m.mode,
      winner: m.winner,
      rounds: m.roundsPlayed,
      shops: m.shops,
      shots: m.totalShots,
      callouts: m.callouts,
      names: m.players.map((p) => p.name),
      title: document.querySelector("#winner-name").textContent,
    };
  });
  await page.close();
  return result;
}

try {
  for (const mode of ["arcade", "gunner", "observer"]) {
    const result = await cpuMatch(mode);
    if (result.phase !== "done") throw new Error(`${mode}: phase ${result.phase}`);
    if (result.mode !== mode) throw new Error(`${mode}: ran as ${result.mode}`);
    if (!result.winner) throw new Error(`${mode}: no winner`);
    if (result.rounds < 2) throw new Error(`${mode}: only ${result.rounds} rounds`);
    if (result.shops < 1) throw new Error(`${mode}: shop never opened`);
    if (!result.title.includes("wins")) throw new Error(`${mode}: ${result.title}`);
    if (mode === "observer") {
      const line = result.callouts.join(" | ");
      if (!/ADD|DROP|LEFT|RIGHT|FIRE FOR EFFECT/.test(line)) throw new Error("observer callouts: " + line);
      if (!/LEFT|RIGHT/.test(line)) throw new Error("observer never called a line: " + line);
    }
    console.log(mode, result.names.join(" vs "), result.title, `rounds ${result.rounds}`, `shops ${result.shops}`, `shots ${result.shots}`);
  }

  for (const vp of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const page = await browser.newPage({ viewport: vp });
    arm(page);
    await page.goto(pageUrl(""));
    await page.waitForSelector("#start");
    let bad = await offscreen(page);
    if (bad.length) throw new Error(`setup ${vp.width}x${vp.height} off screen: ${bad.join(", ")}`);

    await page.click('[data-mode="observer"]');
    await page.click('[data-slot="1"][data-kind="cpu"]');
    bad = await offscreen(page);
    if (bad.length) throw new Error(`observer setup ${vp.width}x${vp.height} off screen: ${bad.join(", ")}`);
    await page.click("#start");
    await page.waitForSelector("#who-done");
    bad = await offscreen(page);
    if (bad.length) throw new Error(`who ${vp.width}x${vp.height} off screen: ${bad.join(", ")}`);
    await page.click("#who-done");
    await page.waitForSelector("#fire");
    bad = await offscreen(page);
    if (bad.length) throw new Error(`gun ${vp.width}x${vp.height} off screen: ${bad.join(", ")}`);
    await page.close();
    console.log(`fit ${vp.width}x${vp.height}`);
  }

  const shop = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  arm(shop);
  await shop.goto(pageUrl("?shop=1"));
  await shop.waitForSelector("#start");
  await shop.click('[data-slot="1"][data-kind="cpu"]');
  await shop.click("#start");
  await shop.waitForSelector("#to-shop");
  await shop.click("#to-shop");
  await shop.waitForSelector("#shop-done");
  await shop.click('[data-buy="shovel"]');
  const packed = await shop.evaluate(() => window.__fm.match.players[0].shovelNext === true && window.__fm.match.players[0].cash === 180);
  if (!packed) throw new Error("shovel did not pack");
  let bad = await offscreen(shop);
  if (bad.length) throw new Error(`shop off screen: ${bad.join(", ")}`);
  await shop.click("#shop-done");
  await shop.waitForSelector("#next", { timeout: 8000 });
  await shop.click("#next");
  await shop.waitForSelector("#fire", { timeout: 8000 });
  await shop.close();
  console.log("shop");

  const solo = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  arm(solo);
  await solo.goto(pageUrl(""));
  await solo.click('[data-mode="observer"]');
  await solo.click('[data-slot="1"][data-kind="cpu"]');
  await solo.click("#start");
  await solo.click("#who-done");
  await solo.click("#fire");
  await solo.waitForSelector("#callout", { timeout: 8000 });
  const call = await solo.locator("#callout").textContent();
  if (!/ADD|DROP|LEFT|RIGHT|FIRE FOR EFFECT|LOST/.test(call)) throw new Error("callout not shown: " + call);
  await solo.close();
  console.log("callout", call);

  if (errors.length) throw new Error("console errors:\n" + errors.join("\n"));
  console.log("ok");
} finally {
  await browser.close();
  server.close();
}
