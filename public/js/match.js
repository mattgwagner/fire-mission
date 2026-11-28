import {
  AMMO,
  GEAR,
  QUICK,
  PALETTE,
  WORLD_W,
  buildTerrain,
  deform,
  groundAt,
  mulberry32,
  observerCallout,
  placeGuns,
  resolveFlight,
  settleGuns,
} from "./sim.js";

export const BASE_PAY = 100;
export const CATCHUP = 90;
const MAX_SHOTS = 36;

const BLAST = {
  he: { radius: 44, damage: 55, crater: 24, depth: 18 },
  big: { radius: 62, damage: 85, crater: 40, depth: 28 },
  cluster: { radius: 30, damage: 32, crater: 14, depth: 9 },
  burrower: { radius: 40, damage: 50, crater: 22, depth: 30 },
};
const REPAIR = 35;
const BURY_REACH = 26;
const SMOKE_R = 90;

export function catalogItem(id) {
  return [...AMMO, ...QUICK, ...GEAR].find((a) => a.id === id) || null;
}

function emptyInv() {
  return Object.fromEntries([...AMMO, ...QUICK].filter((a) => a.price > 0).map((a) => [a.id, 0]));
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
    inv: emptyInv(),
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
    p.buried = false;
    p.digImmune = false;
    p.spotted = false;
    p.repaired = false;
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
  m.lastSubs = [];
  m.lastBursts = [];
  m.lastImpact = null;
  m.skipNote = "";
  m.fx = [];
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

function boomAt(m, shooter, x, lateral, spec, directId, notes) {
  deform(m.terrain, x, spec.crater, spec.depth);
  notes.push(...blast(m, x, lateral, spec.radius, spec.damage, shooter, directId));
  m.lastBursts.push({ x, y: groundAt(m.terrain, x), r: spec.radius });
}

function applyImpact(m, shooter, pending) {
  const { hit, weapon } = pending;
  const notes = [];
  m.lastBursts = [];
  m.lastBuried = [];
  const impact = { x: hit.x, y: hit.y, lateral: hit.lateral || 0, off: hit.off, gunId: hit.gunId };
  const subs = (pending.subs || []).filter((b) => !b.off);
  // A flare works wherever it comes down, even off the map.
  if (weapon === "illum") shooter.spotted = true;
  if (hit.off && !subs.length) {
    notes.push("Off the map");
    m.lastImpact = impact;
    return notes;
  }
  let near;
  if (weapon === "cluster" && subs.length) {
    for (const b of subs) boomAt(m, shooter, b.x, b.lateral, BLAST.cluster, b.gunId, notes);
    near = subs.map((b) => ({ x: b.x, reach: BLAST.cluster.crater + 30 }));
    if (hit.off) Object.assign(impact, { x: subs[0].x, y: subs[0].y, off: false });
  } else if (weapon === "illum") {
    m.light = 4;
    notes.push(m.map === "night" ? "The hill lights up" : "Flare up: next shot shows its whole arc");
    near = [];
  } else if (weapon === "dirt") {
    deform(m.terrain, hit.x, 40, -30);
    notes.push("Dirt piled up");
    for (const g of m.players) {
      if (g.hp <= 0 || g.digImmune) continue;
      if (Math.hypot(g.x - hit.x, (hit.lateral || 0)) > BURY_REACH) continue;
      g.buried = true;
      m.lastBuried.push(g.id);
      const dealt = hurt(g, 8, shooter);
      notes.push(`${g.name} is buried (${dealt})`);
    }
    near = [{ x: hit.x, reach: 40 + 30 }];
  } else if (weapon === "burrower") {
    boomAt(m, shooter, hit.x, hit.lateral, BLAST.burrower, hit.gunId, notes);
    if (hit.gunId) notes.unshift("It came up underneath");
    near = [{ x: hit.x, reach: BLAST.burrower.crater + 60 }];
  } else {
    const spec = BLAST[weapon] || BLAST.he;
    boomAt(m, shooter, hit.x, hit.lateral, spec, hit.gunId, notes);
    if (weapon === "roller" && hit.rolled > 20) notes.unshift(`Rolled ${Math.round(hit.rolled)} m`);
    near = [{ x: hit.x, reach: spec.crater + 30 }];
  }
  notes.push(...settleGuns(m.terrain, m.players, shooter, (target, amount, by) => hurt(target, amount, by), near));
  for (const p of m.players) p.y = groundAt(m.terrain, p.x);
  m.lastImpact = impact;
  return notes;
}

// Quick items: used while aiming, and the turn goes on. Each one leaves a note in
// m.fx so the screen can show it (a CPU uses them inside chooseShot).
export function useRepair(m) {
  const p = currentPlayer(m);
  if (m.phase !== "aim" || !p) return { ok: false, reason: "Not your turn" };
  if ((p.inv.repair || 0) <= 0) return { ok: false, reason: "No repair kits" };
  if (p.repaired) return { ok: false, reason: "One repair per turn" };
  if (p.hp >= 100) return { ok: false, reason: "Already at full health" };
  const amount = Math.min(REPAIR, 100 - p.hp);
  p.hp += amount;
  p.inv.repair--;
  p.repaired = true;
  m.fx.push({ kind: "heal", id: p.id, x: p.x, y: p.y, amount });
  m.log.unshift(`${p.name} patches up +${amount}`);
  return { ok: true, amount };
}

export function popSmoke(m) {
  const p = currentPlayer(m);
  if (m.phase !== "aim" || !p) return { ok: false, reason: "Not your turn" };
  if ((p.inv.smoke || 0) <= 0) return { ok: false, reason: "No smoke" };
  if (m.smokes.some((s) => s.by === p.id)) return { ok: false, reason: "Already in smoke" };
  p.inv.smoke--;
  // Two full trips around the table, so everyone shoots at it twice.
  m.smokes.push({ x: p.x, r: SMOKE_R, by: p.id, until: m.turnCount + m.players.length * 2 });
  for (const o of m.players) if (o !== p) o.blindWind = true;
  m.fx.push({ kind: "smoke", id: p.id, x: p.x, y: p.y });
  m.log.unshift(`${p.name} pops smoke`);
  return { ok: true };
}

export function inSmoke(m, viewerId, x) {
  return m.smokes.some((s) => s.by !== viewerId && Math.abs(s.x - x) < s.r * 0.8);
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
  const flight = resolveFlight(m.terrain, m.players, shot, p.blindWind ? 0 : m.wind, weapon);
  m.lastFlight = flight.path;
  m.lastSubs = flight.subs.map((b) => b.path);
  m.pending = { hit: flight.hit, subs: flight.subs, weapon, shooterId: p.id, enemyId: enemy ? enemy.id : null };
  p.spotted = false;
  p.repaired = false;
  p.digImmune = false;
  m.skipNote = "";
  m.phase = "flying";
  return { ok: true };
}

export function commitFlight(m) {
  if (m.phase !== "flying" || !m.pending) return;
  const p = m.players.find((g) => g.id === m.pending.shooterId);
  const enemy = m.players.find((g) => g.id === m.pending.enemyId) || null;
  const before = m.players.map((g) => g.hp);
  const notes = applyImpact(m, p, m.pending);
  m.lastHits = m.players
    .map((g, i) => ({ id: g.id, x: g.x, y: g.y, dealt: before[i] - g.hp, killed: before[i] > 0 && g.hp <= 0 }))
    .filter((hh) => hh.dealt > 0);
  m.lastWeapon = m.pending.weapon;
  const center = m.pending.subs?.[2];
  if (m.lastFlight?.length) p.trail = center ? m.lastFlight.concat(center.path) : m.lastFlight;
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
  // A buried gun spends its turn digging out, then can't be buried again until it fires.
  const skipped = [];
  for (let k = 0; k < n * 2 && m.players[next].buried; k++) {
    const g = m.players[next];
    g.buried = false;
    g.digImmune = true;
    skipped.push(g.name);
    next = (next + 1) % n;
    for (let j = 0; j < n && m.players[next].hp <= 0; j++) next = (next + 1) % n;
  }
  m.skipNote = skipped.length ? `${skipped.join(" and ")} ${skipped.length > 1 ? "dig" : "digs"} out and ${skipped.length > 1 ? "lose a turn" : "loses a turn"}` : "";
  if (m.skipNote) m.log.unshift(m.skipNote);
  m.turnIndex = next;
  m.pendingCallout = "";
  driftWind(m);
  m.lastFlight = null;
  m.lastSubs = [];
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
