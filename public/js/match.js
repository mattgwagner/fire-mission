import {
  AMMO,
  GEAR,
  PALETTE,
  WORLD_W,
  buildTerrain,
  deform,
  fly,
  groundAt,
  mulberry32,
  observerCallout,
  placeGuns,
  settleGuns,
} from "./sim.js";

export const BASE_PAY = 100;
export const CATCHUP = 90;
const MAX_SHOTS = 36;

const BLAST = {
  he: { radius: 44, damage: 55, crater: 24, depth: 18 },
  big: { radius: 62, damage: 85, crater: 40, depth: 28 },
  cluster: { radius: 16, damage: 24, crater: 12, depth: 8 },
};

export function catalogItem(id) {
  return AMMO.find((a) => a.id === id) || GEAR.find((g) => g.id === id) || null;
}

function blankPlayer(raw, index) {
  const color = raw.color || PALETTE[index % PALETTE.length].hex;
  return {
    id: `p${index}`,
    name: (raw.name || `Player ${index + 1}`).slice(0, 16),
    color,
    human: !!raw.human,
    difficulty: raw.difficulty || "medium",
    assist: !!raw.assist,
    hp: 100,
    x: 0,
    y: 0,
    facing: 1,
    angle: 58,
    power: 62,
    mils: 800,
    charge: 4,
    lateral: 0,
    markX: 500,
    weapon: "he",
    cash: 80,
    score: 0,
    inv: { big: 0, cluster: 0, smoke: 0, illum: 0, dirt: 0, digger: 0, guided: 0 },
    armor: false,
    shovelNext: false,
    dugIn: false,
    damageDealt: 0,
    lastPay: 0,
    caughtUp: false,
    blindWind: false,
    bracket: { range: {}, lat: {} },
  };
}

function hurt(target, amount, by) {
  if (target.hp <= 0 || amount <= 0) return 0;
  let d = amount;
  if (target.armor) d *= 0.6;
  if (target.dugIn) d *= 0.75;
  d = Math.max(1, Math.round(d));
  const before = target.hp;
  target.hp = Math.max(0, before - d);
  const dealt = before - target.hp;
  if (by && by !== target) by.damageDealt += dealt;
  return dealt;
}

function blast(m, x, lateral, radius, damage, by, directId) {
  const notes = [];
  for (const g of m.players) {
    if (g.hp <= 0) continue;
    let dealt = 0;
    if (g.id === directId) dealt = hurt(g, damage, by);
    else {
      const dist = Math.hypot(g.x - x, lateral || 0);
      // Squared falloff: a near miss stings, a miss two tank-widths off barely
      // scratches. The shooter takes half splash so a short round isn't suicide.
      const share = dist < radius ? (1 - dist / radius) ** 2 : 0;
      if (share > 0) dealt = hurt(g, damage * share * (g === by ? 0.5 : 1), by);
    }
    if (dealt > 0) notes.push(`${g.name} takes ${dealt}`);
  }
  return notes;
}

function freshRound(m) {
  m.terrain = buildTerrain(m.map, (m.seed + m.roundNumber * 997) >>> 0);
  for (const p of m.players) {
    p.hp = 100;
    p.damageDealt = 0;
    p.caughtUp = false;
    p.blindWind = false;
    p.dugIn = p.shovelNext;
    p.shovelNext = false;
    p.bracket = { range: {}, lat: {} };
    p.lateral = 0;
    p.trail = null;
    p.lastCall = "";
    p.cpuShots = 0;
    if ((p.inv[p.weapon] || 0) <= 0 && p.weapon !== "he") p.weapon = "he";
  }
  placeGuns(m.terrain, m.players, m.rng);
  // Observer mode: the FO's first call gives the gun a rough range to start from (rounded to 50 m, off by up to ~75 m).
  for (const p of m.players) {
    const foe = nearestEnemy(m, p);
    if (!foe) continue;
    const est = Math.abs(foe.x - p.x) + (m.rng() * 2 - 1) * 75;
    p.targetCall = `TARGET ${Math.max(50, Math.round(est / 50) * 50)} METERS, ${foe.x > p.x ? "RIGHT" : "LEFT"}`;
  }
  m.smokes = [];
  m.light = 0;
  m.shotsThisRound = 0;
  m.turnIndex = (m.roundNumber - 1) % m.players.length;
  m.turnCount = 0;
  m.lastFlight = null;
  m.lastImpact = null;
  m.pendingCallout = "";
  m.log = [];
  rollWind(m);
  m.phase = "aim";
}

export function createMatch(opts) {
  const players = (opts.players || []).slice(0, 4).map(blankPlayer);
  const m = {
    mode: opts.mode || "arcade",
    map: opts.map || "hills",
    bestOf: opts.bestOf || 3,
    seed: opts.seed ?? 1,
    rng: null,
    humanFO: !!opts.humanFO,
    players,
    roundNumber: 1,
    roundsPlayed: 0,
    shops: 0,
    turnIndex: 0,
    turnCount: 0,
    shotsThisRound: 0,
    wind: 0,
    light: 0,
    smokes: [],
    terrain: null,
    phase: "aim",
    shopIndex: 0,
    winner: null,
    roundWinner: null,
    lastFlight: null,
    lastImpact: null,
    pendingCallout: "",
    callouts: [],
    log: [],
    totalShots: 0,
  };
  m.rng = mulberry32(m.seed);
  freshRound(m);
  return m;
}

// Wind is set at the start of a round and only drifts a notch at a time, so a
// gun can walk its rounds onto the target. A fresh roll every turn made the last
// shot useless as a reference.
function rollWind(m) {
  m.wind = Math.round((m.rng() * 2 - 1) * 6);
}

function driftWind(m) {
  const r = m.rng();
  const step = r < 0.2 ? -1 : r > 0.8 ? 1 : 0;
  m.wind = Math.max(-6, Math.min(6, m.wind + step));
}

export function currentIndex(m) {
  const n = m.players.length;
  for (let k = 0; k < n; k++) {
    const i = (m.turnIndex + k) % n;
    if (m.players[i].hp > 0) return i;
  }
  return -1;
}

export function currentPlayer(m) {
  const i = currentIndex(m);
  return i < 0 ? null : m.players[i];
}

export function nearestEnemy(m, p) {
  let best = null;
  for (const o of m.players) {
    if (o === p || o.hp <= 0) continue;
    const d = Math.abs(o.x - p.x);
    if (!best || d < best.d) best = { o, d };
  }
  return best ? best.o : null;
}

export function shotFrom(m, p, overrides = {}) {
  return {
    mode: m.mode,
    x: p.x,
    y: p.y,
    angle: p.angle,
    power: p.power,
    facing: p.facing,
    mils: p.mils,
    charge: p.charge,
    lateral: p.lateral,
    weapon: p.weapon,
    markX: p.markX,
    trace: true,
    ...overrides,
  };
}

function needWins(m) {
  return Math.floor(m.bestOf / 2) + 1;
}

function pay(m) {
  for (const p of m.players) {
    const earn = BASE_PAY + Math.round(p.damageDealt * 2);
    p.cash += earn;
    p.lastPay = earn;
    p.caughtUp = false;
  }
  const scores = m.players.map((p) => p.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (min !== max) {
    for (const p of m.players) {
      if (p.score === min) {
        p.cash += CATCHUP;
        p.lastPay += CATCHUP;
        p.caughtUp = true;
      }
    }
  }
}

function endRound(m, winner) {
  m.roundsPlayed++;
  m.roundWinner = winner ? winner.id : null;
  if (winner) winner.score++;
  pay(m);
  const ranked = [...m.players].sort((a, b) => b.score - a.score);
  const need = needWins(m);
  const ahead = ranked[0].score > ranked[1].score;
  if (ranked[0].score >= need || (m.roundsPlayed >= m.bestOf && ahead) || m.roundsPlayed >= m.bestOf + 3) {
    m.winner = ranked[0].score === ranked[1].score ? null : ranked[0].id;
    m.phase = "done";
    return;
  }
  m.phase = "roundend";
}

function checkRound(m) {
  const alive = m.players.filter((p) => p.hp > 0);
  if (alive.length <= 1) {
    endRound(m, alive[0] || null);
    return;
  }
  if (m.shotsThisRound >= MAX_SHOTS) {
    const ranked = [...alive].sort((a, b) => b.hp - a.hp);
    endRound(m, ranked[0].hp > ranked[1].hp ? ranked[0] : null);
  }
}

function applyImpact(m, shooter, hit, weapon) {
  const notes = [];
  const impact = { x: hit.x, y: hit.y, lateral: hit.lateral || 0, off: hit.off, gunId: hit.gunId };
  if (hit.off) {
    notes.push("Off the map");
    m.lastImpact = impact;
    return notes;
  }
  if (weapon === "smoke") {
    m.smokes.push({ x: hit.x, r: 110, by: shooter.id, until: m.turnCount + m.players.length });
    for (const o of m.players) if (o !== shooter) o.blindWind = true;
    notes.push("Smoke down");
  } else if (weapon === "illum") {
    m.light = 4;
    notes.push("The hill lights up");
  } else if (weapon === "dirt") {
    deform(m.terrain, hit.x, 34, -24);
    notes.push("Dirt piled up");
  } else if (weapon === "digger") {
    deform(m.terrain, hit.x, 16, 72);
    notes.push("The ground drops");
  } else if (weapon === "cluster") {
    const spec = BLAST.cluster;
    const spreads = [-36, -18, 0, 18, 36];
    const lats = [-18, 10, 0, -8, 16];
    spreads.forEach((dx, i) => {
      const x = Math.max(0, Math.min(WORLD_W, hit.x + dx));
      deform(m.terrain, x, spec.crater, spec.depth);
      notes.push(...blast(m, x, (hit.lateral || 0) + lats[i], spec.radius, spec.damage, shooter, null));
    });
  } else {
    const spec = BLAST[weapon] || BLAST.he;
    deform(m.terrain, hit.x, spec.crater, spec.depth);
    notes.push(...blast(m, hit.x, hit.lateral, spec.radius, spec.damage, shooter, hit.gunId));
  }
  notes.push(...settleGuns(m.terrain, m.players, shooter, (target, amount, by) => hurt(target, amount, by), groundChange(hit, weapon)));
  for (const p of m.players) p.y = groundAt(m.terrain, p.x);
  m.lastImpact = impact;
  return notes;
}

// Where the ground moved: the crater plus a margin for the dirt that slumps off its lips.
function groundChange(hit, weapon) {
  const margin = 30;
  if (weapon === "smoke" || weapon === "illum") return [];
  if (weapon === "dirt") return [{ x: hit.x, reach: 34 + margin }];
  if (weapon === "digger") return [{ x: hit.x, reach: 16 + margin * 2 }];
  if (weapon === "cluster") return [{ x: hit.x, reach: 36 + BLAST.cluster.crater + margin }];
  return [{ x: hit.x, reach: (BLAST[weapon] || BLAST.he).crater + margin }];
}

export function fire(m) {
  if (m.phase !== "aim") return { ok: false, reason: "Not your turn" };
  const p = currentPlayer(m);
  if (!p) return { ok: false, reason: "Nobody left" };
  const weapon = p.weapon || "he";
  if (weapon !== "he") {
    if ((p.inv[weapon] || 0) <= 0) return { ok: false, reason: "You don't have that round" };
    p.inv[weapon]--;
  }
  const enemy = nearestEnemy(m, p);
  // Remember who fired. turnIndex can still be sitting on a dead gun from the
  // previous handoff, while currentIndex skipped ahead to this shooter.
  m.shooterIndex = currentIndex(m);
  if (weapon === "guided" && enemy && !Number.isFinite(p.markX)) p.markX = enemy.x;
  const shot = shotFrom(m, p);
  const hit = fly(m.terrain, m.players, shot, p.blindWind ? 0 : m.wind);
  m.lastFlight = hit.path;
  m.pending = { hit, weapon, shooterId: p.id, enemyId: enemy ? enemy.id : null };
  m.phase = "flying";
  return { ok: true };
}

export function commitFlight(m) {
  if (m.phase !== "flying" || !m.pending) return;
  const p = m.players.find((g) => g.id === m.pending.shooterId);
  const enemy = m.players.find((g) => g.id === m.pending.enemyId) || null;
  const before = m.players.map((g) => g.hp);
  const notes = applyImpact(m, p, m.pending.hit, m.pending.weapon);
  m.lastHits = m.players
    .map((g, i) => ({ id: g.id, x: g.x, y: g.y, dealt: before[i] - g.hp, killed: before[i] > 0 && g.hp <= 0 }))
    .filter((hh) => hh.dealt > 0);
  m.lastWeapon = m.pending.weapon;
  p.trail = m.pending.hit.path;
  m.pending = null;
  m.shotsThisRound++;
  m.totalShots++;
  m.turnCount++;
  p.blindWind = false;
  m.light = Math.max(0, m.light - 1);
  m.smokes = m.smokes.filter((s) => s.until > m.turnCount);
  if (m.mode === "observer" && enemy && m.lastImpact && !m.lastImpact.off) {
    m.pendingCallout = observerCallout(p, m.lastImpact, enemy);
    m.callouts.push(m.pendingCallout);
    p.lastCall = m.pendingCallout;
  } else if (m.mode === "observer" && m.lastImpact?.off) {
    m.pendingCallout = "LOST";
    m.callouts.push(m.pendingCallout);
    p.lastCall = m.pendingCallout;
  } else {
    m.pendingCallout = "";
  }
  const line = `${p.name}: ${notes.filter(Boolean).join(". ") || "No effect"}`;
  m.log.unshift(line);
  m.log = m.log.slice(0, 4);
  checkRound(m);
  if (m.phase === "flying") {
    if (m.mode === "observer" && m.humanFO && p.human) m.phase = "callout";
    else m.phase = "handoff";
  }
}

export function confirmCallout(m, text) {
  if (m.phase !== "callout") return;
  if (text) {
    m.pendingCallout = text.slice(0, 80);
    if (m.callouts.length) m.callouts[m.callouts.length - 1] = m.pendingCallout;
    const shooter = m.players[m.shooterIndex ?? m.turnIndex];
    if (shooter) shooter.lastCall = m.pendingCallout;
  }
  m.phase = "handoff";
}

export function handoff(m) {
  if (m.phase !== "handoff") return;
  // Advance from the gun that actually fired. If that gun died on the shot,
  // turnIndex still names it. If an earlier handoff had landed on a dead gun,
  // turnIndex names the corpse and shooterIndex names who really fired.
  const n = m.players.length;
  const from = m.shooterIndex ?? m.turnIndex;
  let next = (from + 1) % n;
  for (let k = 0; k < n; k++) {
    if (m.players[next].hp > 0) break;
    next = (next + 1) % n;
  }
  m.turnIndex = next;
  m.pendingCallout = "";
  driftWind(m);
  m.lastFlight = null;
  m.lastHits = [];
  m.phase = "aim";
}

export function enterShop(m) {
  if (m.phase !== "roundend") return;
  m.shops++;
  m.shopIndex = 0;
  m.phase = "shop";
}

export function buy(m, itemId) {
  if (m.phase !== "shop") return { ok: false, reason: "Shop is closed" };
  const p = m.players[m.shopIndex];
  const item = catalogItem(itemId);
  if (!item || item.price <= 0) return { ok: false, reason: "Not for sale" };
  if (p.cash < item.price) return { ok: false, reason: "Not enough cash" };
  if (itemId === "armor") {
    if (p.armor) return { ok: false, reason: "Already plated" };
    p.armor = true;
  } else if (itemId === "shovel") {
    if (p.shovelNext) return { ok: false, reason: "Already digging in" };
    p.shovelNext = true;
  } else {
    p.inv[itemId] = (p.inv[itemId] || 0) + 1;
  }
  p.cash -= item.price;
  return { ok: true };
}

export function shopDone(m) {
  if (m.phase !== "shop") return;
  if (m.shopIndex < m.players.length - 1) {
    m.shopIndex++;
    return;
  }
  m.roundNumber++;
  freshRound(m);
}

export function winnerPlayer(m) {
  return m.players.find((p) => p.id === m.winner) || null;
}
