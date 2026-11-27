// Side-view gunnery. x and y are meters, y up. 6400 mils make a full circle.
export const WORLD_W = 1000;
export const BEDROCK = 36;
export const VIEW_H = 520;
const DT = 0.05;
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

export const AMMO = [
  { id: "he", name: "HE", price: 0, hint: "Standard shell" },
  { id: "big", name: "Big HE", price: 160, hint: "Wider crater, harder hit" },
  { id: "cluster", name: "Cluster", price: 180, hint: "Scatters bomblets" },
  { id: "smoke", name: "Smoke", price: 80, hint: "Hides the hill and the wind for a turn" },
  { id: "illum", name: "Illumination", price: 70, hint: "Lights a night map" },
  { id: "dirt", name: "Dirt Mover", price: 90, hint: "Piles up cover" },
  { id: "digger", name: "Digger", price: 100, hint: "Opens a pit" },
  { id: "guided", name: "Guided", price: 280, hint: "Steers toward your mark" },
];

export const GEAR = [
  { id: "armor", name: "Armor", price: 200, hint: "40% less damage for the match" },
  { id: "shovel", name: "Shovel", price: 60, hint: "Dig in: 25% less damage for one round" },
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
  const { vx: vx0, vy: vy0, speed } = velocity(shot);
  let vx = vx0;
  let vy = vy0;
  let x = shot.x;
  let y = shot.y + 6;
  const path = [];
  const trace = shot.trace !== false;
  const lateral = shot.mode === "observer" ? shot.lateral || 0 : 0;
  const guided = shot.weapon === "guided" && Number.isFinite(shot.markX);
  for (let i = 0; i < 6000; i++) {
    if (guided && i > 8) {
      const dx = shot.markX - x;
      vx += Math.max(-40, Math.min(40, dx)) * 0.025;
      const sp = Math.hypot(vx, vy) || 1;
      const cap = speed * 1.25;
      if (sp > cap) {
        vx *= cap / sp;
        vy *= cap / sp;
      }
    }
    vx += (wind || 0) * 0.1 * DT;
    vy -= G * DT;
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
      const fromMuzzle = Math.hypot(x - shot.x, y - (shot.y + 6));
      if (fromMuzzle > 16 && players) {
        for (const g of players) {
          if (g.hp <= 0) continue;
          // The gun body sits on the ground, so the hit circle is centered a few meters up.
          if (Math.hypot(x - g.x, y - (g.y + 6)) < 12) {
            return { path, x: g.x, y: g.y, lateral, off: false, gunId: g.id };
          }
        }
      }
      if (y <= terrain[clampIndex(x)]) {
        return { path, x, y: terrain[clampIndex(x)], lateral, off: false, gunId: null };
      }
    }
  }
  return { path, x, y, lateral, off: true, gunId: null };
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

export function placeGuns(terrain, players) {
  const spots = players.length === 2 ? [0.16, 0.84] : players.length === 3 ? [0.14, 0.5, 0.86] : [0.12, 0.37, 0.63, 0.88];
  const used = [];
  players.forEach((p, i) => {
    const prefer = Math.round(spots[i] * WORLD_W);
    let best = prefer;
    let bestH = -1;
    for (let k = prefer - 50; k <= prefer + 50; k++) {
      if (k < 40 || k > WORLD_W - 40) continue;
      if (used.some((u) => Math.abs(u - k) < 70)) continue;
      if (terrain[k] > bestH) {
        bestH = terrain[k];
        best = k;
      }
    }
    used.push(best);
    p.x = best;
    p.y = terrain[best];
    p.facing = p.x < WORLD_W / 2 ? 1 : -1;
    p.angle = p.facing > 0 ? 58 : 122;
    p.mils = 800;
    p.charge = 4;
    p.power = 62;
    p.lateral = 0;
    const foe = spots[i] < 0.5 ? WORLD_W * 0.84 : WORLD_W * 0.16;
    p.markX = Math.round(foe);
  });
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
