import {
  buy,
  commitFlight,
  confirmCallout,
  createMatch,
  currentPlayer,
  enterShop,
  fire,
  handoff,
  inSmoke,
  nearestEnemy,
  popSmoke,
  shopDone,
  shotFrom,
  useRepair,
} from "./match.js";
import { PALETTE, fly } from "./sim.js";

function missScore(hit, aimX) {
  if (!hit || hit.off || !Number.isFinite(hit.x)) return 1e9;
  return Math.abs(hit.x - aimX) + Math.abs(hit.lateral || 0);
}

// Pick the round before aiming, since a Burrower wants to land short.
function pickWeapon(m, p, enemy, diff) {
  const inv = p.inv;
  if (diff === "easy") return inv.roller > 0 && (p.cpuShots || 0) % 3 === 2 ? "roller" : "he";
  if (m.map === "night" && m.light <= 0 && inv.illum > 0) return "illum";
  if (enemy.hp <= 85 && inv.big > 0) return "big";
  if ((p.cpuShots || 0) <= 1 && inv.cluster > 0) return "cluster";
  if ((p.cpuShots || 0) >= 2 && inv.dirt > 0 && !enemy.digImmune) return "dirt";
  if (inv.burrower > 0) return "burrower";
  if (inv.roller > 0 && enemy.y < p.y - 20) return "roller";
  if (inv.big > 0) return "big";
  return "he";
}

function preview(m, p, overrides, wind) {
  const shot = shotFrom(m, p, { ...overrides, trace: false, weapon: "he" });
  return fly(m.terrain, m.players, shot, wind);
}

export function chooseShot(m) {
  const p = currentPlayer(m);
  const enemy = p && nearestEnemy(m, p);
  if (!p || !enemy) return;
  const diff = p.difficulty || "medium";
  if (diff !== "easy" || p.hp <= 30) {
    if (p.hp <= 55 && p.inv.repair > 0) useRepair(m);
    if (p.hp <= 60 && p.inv.smoke > 0) popSmoke(m);
  }
  const weapon = pickWeapon(m, p, enemy, diff);
  const dir = Math.sign(enemy.x - p.x) || 1;
  const aimX = weapon === "burrower" ? enemy.x - dir * 30 : enemy.x;
  const wind = p.blindWind ? 0 : diff === "hard" ? m.wind : diff === "medium" ? m.wind * 0.4 : 0;
  // A CPU walks its rounds in like a person: wide on the first shot of a round, tighter each shot after.
  const start = diff === "easy" ? 1 : diff === "medium" ? 0.7 : 0.45;
  const floor = diff === "easy" ? 0.6 : diff === "medium" ? 0.22 : 0.06;
  let noise = Math.max(floor, start * 0.6 ** (p.cpuShots || 0));
  // A flare shows the CPU its arc the way it shows a person; smoke over the target hides the last burst.
  if (p.spotted) noise = 0.03;
  if (inSmoke(m, p.id, enemy.x)) noise = Math.max(noise, 0.8);
  p.cpuShots = (p.cpuShots || 0) + 1;
  let best = null;
  if (m.mode === "arcade") {
    for (let angle = 20; angle <= 160; angle += 5) {
      for (const power of [30, 45, 60, 75, 90, 100]) {
        const hit = preview(m, p, { angle, power, mode: "arcade" }, wind);
        const s = missScore(hit, aimX);
        if (!best || s < best.s) best = { s, angle, power };
      }
    }
    // Refine power at the best angle, then add the miss.
    for (let power = best.power - 15; power <= best.power + 15; power += 1) {
      const hit = preview(m, p, { angle: best.angle, power, mode: "arcade" }, wind);
      const sc = missScore(hit, aimX);
      if (sc < best.s) best = { s: sc, angle: best.angle, power };
    }
    p.angle = Math.max(8, Math.min(172, best.angle + (m.rng() * 2 - 1) * noise * 10));
    p.power = Math.max(15, Math.min(100, Math.round(best.power + (m.rng() * 2 - 1) * noise * 9)));
  } else {
    p.facing = enemy.x >= p.x ? 1 : -1;
    for (let mils = 160; mils <= 1440; mils += 80) {
      for (let charge = 1; charge <= 7; charge++) {
        const hit = preview(m, p, { mils, charge, facing: p.facing, lateral: 0 }, wind);
        const s = missScore(hit, aimX);
        if (!best || s < best.s) best = { s, mils, charge };
      }
    }
    for (let mils = best.mils - 60; mils <= best.mils + 60; mils += 15) {
      const hit = preview(m, p, { mils, charge: best.charge, facing: p.facing, lateral: 0 }, wind);
      const s = missScore(hit, aimX);
      if (s < best.s) best = { s, mils, charge: best.charge };
    }
    const span = noise * 160;
    p.mils = Math.max(40, Math.min(1560, Math.round(best.mils + (m.rng() * 2 - 1) * span)));
    p.charge = best.charge;
    // A side-view map has no cross-track axis. The first shot of a bracket
    // carries a line miss so the callout has a LEFT/RIGHT, then the gunner corrects.
    const lined = p.bracket && p.bracket.lat && p.bracket.lat.sign != null;
    p.lateral = m.mode === "observer" && !lined ? 70 : 0;
    p.markX = enemy.x;
  }
  p.weapon = weapon;
  if (diff !== "easy" && weapon === "he" && p.inv.guided > 0 && best && best.s > 40) p.weapon = "guided";
}

export function cpuPurchase(m) {
  const p = m.players[m.shopIndex];
  if (!p || p.human) return;
  // A CPU shops for variety so the specials show up on screen, not just Heavy every round.
  const pool = ["big", "cluster", "roller", "burrower", "dirt", "repair", "smoke", "guided"];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(m.rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const wants = p.difficulty === "easy" ? ["repair", "roller"] : ["armor", "shovel", ...pool];
  if (m.map === "night" && p.difficulty !== "easy") wants.unshift("illum");
  let bought = 0;
  for (const id of wants) {
    if (bought >= (p.difficulty === "easy" ? 1 : 3)) break;
    const res = buy(m, id);
    if (res.ok) bought++;
  }
}

export function playCpuMatch(opts) {
  const difficulty = opts.difficulty || "hard";
  const players = opts.players || [0, 1].map((i) => ({
    name: ["Ace", "Pip"][i],
    color: PALETTE[i].hex,
    human: false,
    difficulty,
    assist: false,
  }));
  const m = createMatch({
    mode: opts.mode,
    map: opts.map || "hills",
    bestOf: opts.bestOf || 3,
    seed: opts.seed ?? 1,
    humanFO: false,
    players,
  });
  let guard = 0;
  while (m.phase !== "done" && guard++ < 5000) {
    if (m.phase === "aim") {
      chooseShot(m);
      const res = fire(m);
      if (!res.ok) {
        m.stuck = res.reason;
        break;
      }
      commitFlight(m);
    } else if (m.phase === "callout") confirmCallout(m, m.pendingCallout);
    else if (m.phase === "handoff") handoff(m);
    else if (m.phase === "roundend") enterShop(m);
    else if (m.phase === "shop") {
      cpuPurchase(m);
      shopDone(m);
    } else break;
  }
  m.guard = guard;
  return m;
}
