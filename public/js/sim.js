// Side-view gunnery. x and y are meters, y up. 6400 mils make a full circle.
export const WORLD_W = 1000;
export const BEDROCK = 36;
export const VIEW_H = 520;
const DT = 0.05;
const GUIDE_ACCEL = 3.2;
const G = 9.8;

export const PALETTE = [
  { id: "coral", hex: "#d6453d", name: "Coral" },
  { id: "gold", hex: "#e0a106", name: "Gold" },
  { id: "green", hex: "#1f8a5b", name: "Green" },
  { id: "blue", hex: "#2f6fed", name: "Blue" },
  { id: "violet", hex: "#7a45c4", name: "Violet" },
  { id: "pink", hex: "#d63b86", name: "Pink" },
  { id: "teal", hex: "#0e8f96", name: "Teal" },
  { id: "orange", hex: "#e07a1f", name: "Orange" },
];

export const CPU_NAMES = ["Ace", "Pip", "Juno", "Sable"];

export const MAPS = [
  { id: "hills", name: "Hills" },
  { id: "valley", name: "Valley" },
  { id: "mesa", name: "Mesa" },
  { id: "night", name: "Night" },
  { id: "random", name: "Random" },
];

// Rounds are fired. Quick items are used while aiming and don't end the turn.
// Gear is bought for the round or the match. `hint` must fit three short lines on a shop card.
export const AMMO = [
  { id: "he", name: "HE", price: 0, hint: "The standard shell. Always free, never runs out." },
  { id: "big", name: "Heavy", price: 150, hint: "Huge blast and a deep crater. A direct hit takes 85." },
  { id: "cluster", name: "Cluster", price: 140, hint: "Pops open at the top of its arc and rains five bomblets across the target." },
  { id: "roller", name: "Roller", price: 110, hint: "Lands, then rolls downhill until it bumps a gun or runs out of speed." },
  { id: "burrower", name: "Burrower", price: 140, hint: "Landed short? It tunnels on up to 60 m and blows up under whoever it reaches." },
  { id: "dirt", name: "Dirt Bomb", price: 90, hint: "Dumps a hill of dirt. A buried gun loses its next turn digging out." },
  { id: "illum", name: "Flare", price: 70, hint: "Lights up a night map and shows your whole arc on your next shot." },
  { id: "guided", name: "Guided", price: 220, hint: "Steers itself onto the mark you set. Fixes a miss of up to about 100 m." },
];

export const QUICK = [
  { id: "repair", name: "Repair Kit", price: 100, hint: "Patch up 35 health, then still take your shot. One per turn." },
  { id: "smoke", name: "Smoke", price: 70, hint: "Pop a cloud around your gun. Enemies can't see you or where their shells land." },
];

export const GEAR = [
  { id: "armor", name: "Armor", price: 200, hint: "Takes 40% less damage for the rest of the match." },
  { id: "shovel", name: "Shovel", price: 60, hint: "Dig in before the next round: 25% less damage that round." },
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(u, a, b) {
  const t = Math.max(0, Math.min(1, (u - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
}

export function buildTerrain(map, seed) {
  const h = new Float64Array(WORLD_W + 1);
  const rng = mulberry32(seed || 1);
  const n1 = rng() * 200;
  const n2 = rng() * 200;
  for (let x = 0; x <= WORLD_W; x++) {
    const u = x / WORLD_W;
    let y;
    if (map === "valley") {
      y = 145 + 210 * Math.cos((u - 0.5) * Math.PI) ** 2 + Math.sin((x + n1) / 48) * 10;
    } else if (map === "mesa") {
      const plateau = Math.min(smooth(u, 0.2, 0.32), smooth(u, 0.8, 0.68));
      y = 125 + 175 * plateau + Math.sin((x + n2) / 60) * 8;
    } else {
      y = 175
        + Math.sin((x + n1) / 92) * 58
        + Math.sin((x + n2) / 43) * 32
        + Math.sin(x / 18) * 12;
      if (map === "random") y += Math.sin((x + n1 * 3) / 27) * 30;
    }
    h[x] = Math.max(BEDROCK, Math.min(360, y));
  }
  return h;
}

function clampIndex(x) {
  return Math.max(0, Math.min(WORLD_W, Math.round(x)));
}

export function groundAt(terrain, x) {
  return terrain[clampIndex(x)];
}

// Dirt slumps until a column is no steeper than MAX_SLOPE. A deep hole fills from the lips.
const MAX_SLOPE = 1.15;
export function relax(terrain) {
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 1; i <= WORLD_W; i++) {
      const slope = terrain[i] - terrain[i - 1];
      if (slope > MAX_SLOPE) {
        const t = (slope - MAX_SLOPE) / 2;
        terrain[i] -= t;
        terrain[i - 1] += t;
        moved = true;
      } else if (slope < -MAX_SLOPE) {
        const t = (-slope - MAX_SLOPE) / 2;
        terrain[i] += t;
        terrain[i - 1] -= t;
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (let i = 0; i <= WORLD_W; i++) {
    if (terrain[i] < BEDROCK) terrain[i] = BEDROCK;
    if (terrain[i] > 400) terrain[i] = 400;
  }
}

export function deform(terrain, x, radius, depth) {
  const r = Math.max(1, radius);
  const i0 = Math.max(0, Math.floor(x - r));
  const i1 = Math.min(WORLD_W, Math.ceil(x + r));
  for (let i = i0; i <= i1; i++) {
    const d = (i - x) / r;
    if (Math.abs(d) > 1) continue;
    terrain[i] -= depth * Math.cos((d * Math.PI) / 2);
  }
  relax(terrain);
}

export function velocity(shot) {
  if (shot.mode === "arcade") {
    const rad = ((shot.angle ?? 60) * Math.PI) / 180;
    const speed = 20 + (shot.power ?? 50) * 0.85;
    return { vx: Math.cos(rad) * speed, vy: Math.sin(rad) * speed, speed };
  }
  const mils = shot.mils ?? 800;
  const rad = (mils / 6400) * Math.PI * 2;
  const speed = 28 + (shot.charge ?? 4) * 11;
  const dir = (shot.facing ?? 1) >= 0 ? 1 : -1;
  return { vx: dir * Math.cos(rad) * speed, vy: Math.sin(rad) * speed, speed };
}

// terrain null flies over flat ground at y = 0, including past the map, for the range card.
export function fly(terrain, players, shot, wind) {
  const v = shot.v0 || velocity(shot);
  let vx = v.vx;
  let vy = v.vy;
  const sx = shot.start ? shot.start.x : shot.x;
  const sy = shot.start ? shot.start.y : shot.y + 6;
  let x = sx;
  let y = sy;
  const path = [];
  const trace = shot.trace !== false;
  const lateral = shot.mode === "observer" ? shot.lateral || 0 : 0;
  const guided = shot.weapon === "guided" && Number.isFinite(shot.markX);
  for (let i = 0; i < 6000; i++) {
    if (guided && terrain && i > 8) {
      // Steer for where it will be when it comes down over the mark. Limited authority:
      // it fixes a miss of about 100 m, not a shot fired the wrong way.
      const gy = terrain[clampIndex(shot.markX)];
      const drop = Math.max(0, y - gy);
      const tGo = Math.max(0.6, (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * drop))) / G);
      const want = (shot.markX - x) / tGo;
      const turn = GUIDE_ACCEL * DT;
      vx += Math.max(-turn, Math.min(turn, want - vx));
    }
    vx += (wind || 0) * 0.1 * DT;
    const rising = vy > 0;
    vy -= G * DT;
    if (shot.apex && rising && vy <= 0 && i > 8) {
      path.push({ x, y });
      return { path, x, y, vx, vy, lateral, off: false, gunId: null, apex: true };
    }
    x += vx * DT;
    y += vy * DT;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { path, x: shot.x, y: shot.y, lateral, off: true, gunId: null };
    }
    if (trace && i % 3 === 0) path.push({ x, y });
    if (y > 900) return { path, x, y, lateral, off: true, gunId: null };
    if (terrain && (x < -20 || x > WORLD_W + 20)) return { path, x, y, lateral, off: true, gunId: null };
    if (!terrain && y <= 0) return { path, x, y: 0, lateral, off: false, gunId: null };
    if (terrain && i > 6) {
      const fromMuzzle = Math.hypot(x - sx, y - sy);
      if (fromMuzzle > 16 && players) {
        for (const g of players) {
          if (g.hp <= 0) continue;
          // The gun body sits on the ground, so the hit circle is centered a few meters up.
          if (Math.hypot(x - g.x, y - (g.y + 6)) < 12) {
            return { path, x: g.x, y: g.y, vx, lateral, off: false, gunId: g.id };
          }
        }
      }
      if (y <= terrain[clampIndex(x)]) {
        return { path, x, y: terrain[clampIndex(x)], vx, lateral, off: false, gunId: null };
      }
    }
  }
  return { path, x, y, lateral, off: true, gunId: null };
}

// Bomblets leave the apex with these extra side speeds (m/s), so the spread grows with the drop.
export const CLUSTER_SPREAD = [-14, -7, 0, 7, 14];
const CLUSTER_LATERAL = [-18, 10, 0, -8, 16];
const ROLL_MAX = 260;
export const BURROW_MAX = 60;

function gunNear(players, x, reach) {
  return players ? players.find((g) => g.hp > 0 && Math.abs(g.x - x) < reach) : null;
}

// A roller keeps the speed it landed with, gains it going downhill and loses it to friction and climbing.
function roll(terrain, players, hit) {
  let x = clampIndex(hit.x);
  const fall = terrain[Math.max(0, x - 4)] - terrain[Math.min(WORLD_W, x + 4)];
  let dir = Math.abs(fall) > 1 ? Math.sign(fall) : Math.sign(hit.vx || 1);
  let v2 = 100;
  const path = [];
  for (let d = 0; d < ROLL_MAX; d++) {
    const nx = x + dir;
    if (nx < 2 || nx > WORLD_W - 2) break;
    const g = gunNear(players, nx, 9);
    if (g) return { path, x: g.x, y: g.y, gunId: g.id, dist: d };
    v2 += 2 * G * 0.7 * (terrain[x] - terrain[nx]) - 2.4;
    if (v2 <= 0) break;
    x = nx;
    if (d % 4 === 0) path.push({ x, y: terrain[x] + 1.5 });
  }
  return { path, x, y: terrain[x], gunId: null, dist: Math.abs(x - hit.x) };
}

function burrow(terrain, players, hit) {
  const dir = Math.sign(hit.vx || 1);
  let x = clampIndex(hit.x);
  const path = [];
  for (let d = 0; d < BURROW_MAX; d += 2) {
    const nx = clampIndex(hit.x + dir * d);
    if (nx <= 2 || nx >= WORLD_W - 2) break;
    x = nx;
    path.push({ x, y: terrain[x] - 7, under: true });
    const g = gunNear(players, x, 8);
    if (g) return { path, x: g.x, y: terrain[clampIndex(g.x)], gunId: g.id };
  }
  return { path, x, y: terrain[x], gunId: null };
}

// The whole flight of one round, physics only: where it goes and where it bursts.
// `hit` is the main burst (the one the observer calls), `subs` are cluster bomblets.
export function resolveFlight(terrain, players, shot, wind, weapon) {
  if (weapon === "cluster") {
    const top = fly(terrain, players, { ...shot, apex: true }, wind);
    if (!top.apex) return { path: top.path, hit: top, subs: [] };
    const subs = CLUSTER_SPREAD.map((dv, i) => {
      const b = fly(terrain, players, {
        ...shot,
        weapon: "he",
        apex: false,
        start: { x: top.x, y: top.y },
        v0: { vx: top.vx + dv, vy: top.vy },
      }, wind);
      return shot.mode === "observer" ? { ...b, lateral: (shot.lateral || 0) + CLUSTER_LATERAL[i] } : b;
    });
    return { path: top.path, hit: subs[2], subs };
  }
  const hit = fly(terrain, players, shot, wind);
  if (hit.off || hit.gunId || !terrain) return { path: hit.path, hit, subs: [] };
  if (weapon === "roller") {
    const r = roll(terrain, players, hit);
    return { path: hit.path.concat(r.path), hit: { ...hit, x: r.x, y: r.y, gunId: r.gunId, rolled: r.dist }, subs: [] };
  }
  if (weapon === "burrower") {
    const b = burrow(terrain, players, hit);
    return { path: hit.path.concat(b.path), hit: { ...hit, x: b.x, y: b.y, gunId: b.gunId, burrowed: true }, subs: [] };
  }
  return { path: hit.path, hit, subs: [] };
}

let rangeCardCache = null;
export function rangeCard() {
  if (rangeCardCache) return rangeCardCache;
  const milsList = [200, 400, 800, 1100, 1400];
  const rows = [];
  for (let charge = 1; charge <= 7; charge++) {
    const cells = [];
    for (const mils of milsList) {
      const hit = fly(null, null, { mode: "gunner", x: 0, y: 0, mils, charge, facing: 1, trace: false }, 0);
      const range = hit && Number.isFinite(hit.x) ? Math.max(0, Math.round(hit.x / 10) * 10) : null;
      cells.push({ mils, range });
    }
    rows.push({ charge, cells });
  }
  rangeCardCache = { mils: milsList, rows };
  return rangeCardCache;
}

// Who stands where is shuffled every round, and each slot drifts a little, so the
// same player never starts in the same spot by habit.
export function placeGuns(terrain, players, rng = Math.random) {
  const n = players.length;
  const gap = WORLD_W / n;
  const slots = [];
  for (let i = 0; i < n; i++) {
    const center = gap * (i + 0.5);
    const jitter = (rng() * 2 - 1) * gap * 0.22;
    slots.push(Math.round(Math.max(60, Math.min(WORLD_W - 60, center + jitter))));
  }
  const order = players.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const used = [];
  players.forEach((p, i) => {
    const prefer = slots[order[i]];
    let best = prefer;
    let bestH = -1;
    for (let k = prefer - 50; k <= prefer + 50; k++) {
      if (k < 40 || k > WORLD_W - 40) continue;
      if (used.some((u) => Math.abs(u - k) < 90)) continue;
      if (terrain[k] > bestH) {
        bestH = terrain[k];
        best = k;
      }
    }
    used.push(best);
    p.x = best;
    p.y = terrain[best];
    p.mils = 800;
    p.charge = 4;
    p.power = 62;
    p.lateral = 0;
  });
  for (const p of players) {
    let foe = null;
    for (const q of players) if (q !== p && (!foe || Math.abs(q.x - p.x) < Math.abs(foe.x - p.x))) foe = q;
    p.facing = foe ? (foe.x > p.x ? 1 : -1) : p.x < WORLD_W / 2 ? 1 : -1;
    p.angle = p.facing > 0 ? 58 : 122;
    p.markX = foe ? Math.round(foe.x) : Math.round(WORLD_W / 2);
  }
}

// Only guns whose ground was just changed can move. Settling every gun made a gun
// parked on a slope slide (and take damage) on someone else's shot across the map.
export function settleGuns(terrain, players, by, hurt, near = null) {
  const notes = [];
  for (const p of players) {
    if (p.hp <= 0) continue;
    if (near && !near.some((n) => Math.abs(p.x - n.x) <= n.reach)) continue;
    for (let n = 0; n < 4; n++) {
      const x = clampIndex(p.x);
      const left = terrain[Math.max(0, x - 10)];
      const right = terrain[Math.min(WORLD_W, x + 10)];
      const here = terrain[x];
      let next = x;
      if ((here - left) / 10 > 0.9 && left <= right) next = Math.max(16, x - 8);
      else if ((here - right) / 10 > 0.9 && right < left) next = Math.min(WORLD_W - 16, x + 8);
      else break;
      if (players.some((o) => o !== p && o.hp > 0 && Math.abs(o.x - next) < 18)) break;
      p.x = next;
      // Sliding is gentle: follow the slope down instead of counting it as a fall.
      p.y = Math.min(p.y, terrain[clampIndex(next)]);
      if (n === 0) notes.push(`${p.name} slides`);
    }
    const y = terrain[clampIndex(p.x)];
    const drop = p.y - y;
    p.y = y;
    // A normal HE crater (18 deep) settles a gun without real harm; a Digger
    // pit (72 deep) still hurts.
    if (drop > 16) {
      const dealt = hurt(p, (drop - 16) * 0.8, by);
      notes.push(`${p.name} falls (${dealt})`);
    } else {
      p.y = y;
    }
  }
  return notes;
}

const BRACKETS = [100, 200, 400, 800];

function firstMag(abs) {
  return BRACKETS.find((s) => s >= abs) || 800;
}

// Successive bracket: the first correction rounds up, and a sign change (or a smaller miss) splits it.
function correction(mem, err, positiveWord, negativeWord) {
  if (Math.abs(err) < 25) return null;
  const sign = err > 0 ? 1 : -1;
  const word = err > 0 ? positiveWord : negativeWord;
  const up = firstMag(Math.abs(err));
  let mag;
  if (mem.sign == null) mag = up;
  else if (sign !== mem.sign || Math.abs(err) < mem.mag) mag = Math.max(100, mem.mag / 2);
  else mag = up;
  mem.sign = sign;
  mem.mag = mag;
  return `${word} ${mag}`;
}

export function observerCallout(shooter, impact, target) {
  const dir = Math.sign(target.x - shooter.x) || 1;
  const along = (impact.x - target.x) * dir;
  const lateral = impact.lateral || 0;
  if (Math.hypot(along, lateral) <= 50) return "FIRE FOR EFFECT";
  shooter.bracket = shooter.bracket || { range: {}, lat: {} };
  const parts = [
    correction(shooter.bracket.range, along, "DROP", "ADD"),
    correction(shooter.bracket.lat, lateral, "LEFT", "RIGHT"),
  ].filter(Boolean);
  return parts.join(", ") || "FIRE FOR EFFECT";
}

export function maskLine(terrain, gunX, enemyX) {
  const dir = enemyX >= gunX ? 1 : -1;
  let crest = clampIndex(gunX);
  let crestH = terrain[crest];
  for (let i = 0; i <= 90; i++) {
    const xx = clampIndex(gunX + dir * i);
    if (terrain[xx] >= crestH) {
      crestH = terrain[xx];
      crest = xx;
    }
  }
  return crest + dir * 18;
}
