// Fires every special round and both quick items in a live battle (human vs CPU), failing on any
// console error. Pass an output dir to also save a screenshot of each round mid-flight and after.
// Usage: node e2e/rounds.mjs [outdir]
import { launch, pageUrl, serve, setBase } from "./pw.mjs";
const out = process.argv[2];
const server = await serve();
setBase(`http://127.0.0.1:${server.address().port}`);
const browser = await launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.goto(pageUrl("?seed=3"));
  await page.click('[data-map="valley"]');
  await page.click('[data-slot="1"][data-kind="cpu"]');
  await page.click('[data-slot="1"][data-diff="easy"]');
  await page.click("#start");
  await page.click("#who-done");
  await page.waitForSelector("#fire");
  await page.evaluate(() => {
    const m = window.__fm.match;
    for (const p of m.players) { p.armor = true; for (const k of Object.keys(p.inv)) p.inv[k] = 3; }
    m.players[0].hp = 60;
  });
  await page.click('[data-weapon="he"]');
  await page.click('[data-quick="repair"]');
  await page.click('[data-quick="smoke"]');
  const q = await page.evaluate(() => ({ hp: window.__fm.match.players[0].hp, smokes: window.__fm.match.smokes.length }));
  if (q.hp !== 95 || q.smokes !== 1) throw new Error("quick items: " + JSON.stringify(q));
  for (const w of ["cluster", "roller", "burrower", "dirt", "illum", "guided", "big"]) {
    for (let k = 0; k < 60; k++) {
      const st = await page.evaluate(() => ({ phase: window.__fm.phase, fire: !!document.querySelector("#fire"), next: !!document.querySelector("#next") }));
      if (st.phase === "aim" && st.fire) break;
      if (st.phase === "roundend" || st.phase === "done") break;
      if (st.phase === "handoff" && st.next) await page.click("#next");
      else await page.waitForTimeout(300);
    }
    if (await page.evaluate(() => window.__fm.match.phase !== "aim")) break;
    await page.click(`[data-weapon="${w}"]`);
    await page.click("#fire");
    if (out) { await page.waitForTimeout(w === "cluster" ? 1500 : 1000); await page.screenshot({ path: `${out}/fly-${w}.png` }); }
    await page.waitForSelector("#next", { timeout: 8000 });
    if (out) { await page.waitForTimeout(250); await page.screenshot({ path: `${out}/hit-${w}.png` }); }
    const res = await page.evaluate(() => document.querySelector(".result-big")?.textContent);
    console.log(w, "→", res);
    await page.click("#next");
  }
  if (errors.length) throw new Error("console errors:\n" + errors.join("\n"));
  console.log("ok");
} finally {
  await browser.close();
  server.close();
}
