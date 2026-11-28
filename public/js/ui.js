import { boom, isMuted, shotSound, toggleMute, unlock, winSound } from "./audio.js";
import { chooseShot, cpuPurchase, playCpuMatch } from "./ai.js";
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
  winnerPlayer,
} from "./match.js";
import { glyph, scene } from "./art.js";
import {
  AMMO,
  CPU_NAMES,
  GEAR,
  MAPS,
  PALETTE,
  QUICK,
  VIEW_H,
  WORLD_W,
  fly,
  maskLine,
  rangeCard,
} from "./sim.js";

const KEY = "fire-mission";
let showImpact = false;
let impactHold = 0;
const params = new URLSearchParams(location.search);
const testMode = params.has("test");

let slots = [
  { human: true, difficulty: "medium", name: "Player 1", color: PALETTE[0].hex },
  { human: true, difficulty: "medium", name: "Player 2", color: PALETTE[1].hex },
];
let mode = "arcade";
let mapId = "hills";
let bestOf = 3;
let humanFO = false;
let match = null;
let flightAt = null;
let effects = [];
let animating = false;
let showCard = true;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const dialog = document.querySelector("#lookaway");
const canvas = document.querySelector("#field");
const ctx = canvas.getContext("2d");

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings() {
  const data = {
    mode,
    map: mapId,
    bestOf,
    humanFO,
    slots: slots.map((s) => ({
      human: s.human,
      difficulty: s.difficulty,
      name: s.name,
      color: s.color,
      assist: !!s.assist,
    })),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode or a full disk */
  }
}

function applySettings(saved) {
  if (saved.mode) mode = saved.mode;
  if (saved.map) mapId = saved.map;
  if (saved.bestOf) bestOf = saved.bestOf;
  if (typeof saved.humanFO === "boolean") humanFO = saved.humanFO;
  if (Array.isArray(saved.slots) && saved.slots.length >= 2) {
    slots = saved.slots.slice(0, 4).map((s, i) => ({
      human: s.human !== false,
      difficulty: s.difficulty || "medium",
      name: (s.name || `Player ${i + 1}`).slice(0, 16),
      color: s.color || PALETTE[i].hex,
      assist: !!s.assist,
    }));
  }
}

function h(tag, attrs = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  return node;
}

function button(label, attrs, onClick) {
  const node = h("button", { type: "button", ...attrs, text: label });
  node.addEventListener("click", onClick);
  return node;
}

function show(id) {
  for (const section of document.querySelectorAll("body > section")) section.hidden = section.id !== id;
  if (id !== "battle" && dialog.open) dialog.close();
}

function say(text) {
  const live = document.querySelector("#live");
  if (live.textContent !== text) live.textContent = text;
}

function pressed(on) {
  return on ? "true" : "false";
}

function renderSetup() {
  const root = document.querySelector("#setup");
  root.replaceChildren();
  root.append(h("h1", { text: "Fire Mission" }));
  root.append(h("p", { text: "A side-view artillery duel for 2 to 4 guns." }));

  const modeRow = h("div", { class: "row", role: "group", "aria-label": "Mode" });
  for (const item of [
    ["arcade", "Arcade"],
    ["gunner", "Gunner"],
    ["observer", "Observer"],
  ]) {
    modeRow.append(button(item[1], { "data-mode": item[0], "aria-pressed": pressed(mode === item[0]) }, () => {
      mode = item[0];
      renderSetup();
    }));
  }
  root.append(h("p", { class: "label", text: "Mode" }), modeRow);
  const blurb = {
    arcade: "Angle and power. The classic.",
    gunner: "Elevation in mils and charge 1–7, with a range card. Like a real gun crew.",
    observer: "The target is hidden behind the ridge. The observer calls ADD, DROP, LEFT and RIGHT.",
  }[mode];
  root.append(h("p", { class: "blurb", text: blurb }));

  const mapRow = h("div", { class: "row", role: "group", "aria-label": "Map" });
  for (const item of MAPS) {
    mapRow.append(button(item.name, { "data-map": item.id, "aria-pressed": pressed(mapId === item.id) }, () => {
      mapId = item.id;
      renderSetup();
    }));
  }
  root.append(h("p", { class: "label", text: "Battlefield" }), mapRow);

  const roundRow = h("div", { class: "row", role: "group", "aria-label": "Rounds" });
  for (const n of [3, 5, 7]) {
    roundRow.append(button(`Best of ${n}`, { "data-rounds": String(n), "aria-pressed": pressed(bestOf === n) }, () => {
      bestOf = n;
      renderSetup();
    }));
  }
  root.append(h("p", { class: "label", text: "Match" }), roundRow);

  if (mode === "observer") {
    root.append(button("Human observer", { id: "human-fo", "aria-pressed": pressed(humanFO) }, () => {
      humanFO = !humanFO;
      renderSetup();
    }));
  }

  root.append(h("p", { class: "label", text: "Guns" }));
  const list = h("div", { class: "slots" });
  slots.forEach((slot, i) => {
    const row = h("div", { class: "slot" });
    row.append(h("span", { class: "group-label", text: `Gun ${i + 1}` }));
    row.append(button("Person", { "data-slot": String(i), "data-kind": "human", "aria-pressed": pressed(slot.human) }, () => {
      slot.human = true;
      renderSetup();
    }));
    row.append(button("Computer", { "data-slot": String(i), "data-kind": "cpu", "aria-pressed": pressed(!slot.human) }, () => {
      slot.human = false;
      renderSetup();
    }));
    if (!slot.human) {
      const diff = h("div", { role: "group", "aria-label": `Gun ${i + 1} difficulty` });
      for (const name of ["easy", "medium", "hard"]) {
        diff.append(button(name[0].toUpperCase() + name.slice(1), { "data-slot": String(i), "data-diff": name, "aria-pressed": pressed(slot.difficulty === name) }, () => {
          slot.difficulty = name;
          renderSetup();
        }));
      }
      row.append(diff);
    }
    if (slots.length > 2) {
      row.append(button("Remove", { "data-remove": String(i) }, () => {
        slots.splice(i, 1);
        renderSetup();
      }));
    }
    list.append(row);
  });
  root.append(list);

  if (slots.length < 4) {
    root.append(button("Add player", { id: "add-player" }, () => {
      const i = slots.length;
      slots.push({ human: false, difficulty: "medium", name: `Player ${i + 1}`, color: PALETTE[i].hex });
      renderSetup();
    }));
  }
  root.append(button("Start", { id: "start" }, onStart));
  show("setup");
}

function onStart() {
  unlock();
  saveSettings();
  if (params.has("shop") || !slots.some((s) => s.human)) begin();
  else renderWho();
}

function renderWho() {
  const root = document.querySelector("#who");
  root.replaceChildren();
  root.append(h("h1", { text: "Who am I?" }));
  const humans = slots.filter((s) => s.human);
  humans.forEach((slot, i) => {
    if (!slot.name) slot.name = `Player ${i + 1}`;
    if (!slot.color) slot.color = PALETTE[i].hex;
    const card = h("div", { class: "card" });
    const input = h("input", {
      type: "text",
      id: `name-${i}`,
      maxlength: "16",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": `Name for gun ${i + 1}`,
      value: slot.name,
    });
    input.addEventListener("input", () => {
      slot.name = input.value.slice(0, 16);
    });
    card.append(input);
    const colors = h("div", { class: "row", role: "group", "aria-label": `Color for gun ${i + 1}` });
    for (const color of PALETTE) {
      const taken = humans.some((other) => other !== slot && other.color === color.hex);
      const swatch = button("", {
        class: "swatch",
        "data-color": color.id,
        "aria-label": color.name,
        "aria-pressed": pressed(slot.color === color.hex),
      }, () => {
        if (taken) return;
        slot.color = color.hex;
        renderWho();
      });
      swatch.style.background = color.hex;
      if (taken && slot.color !== color.hex) swatch.disabled = true;
      colors.append(swatch);
    }
    card.append(colors);
    if (mode === "arcade") {
      card.append(button("Assist", { "aria-pressed": pressed(!!slot.assist), "data-assist": String(i) }, () => {
        slot.assist = !slot.assist;
        renderWho();
      }));
    }
    root.append(card);
  });
  root.append(button("Let's play", { id: "who-done" }, () => {
    humans.forEach((slot, i) => {
      const name = (slot.name || "").trim();
      slot.name = name || `Player ${i + 1}`;
    });
    saveSettings();
    begin();
  }));
  show("who");
}

function buildPlayers() {
  const used = new Set();
  let cpu = 0;
  return slots.map((slot) => {
    if (slot.human) {
      used.add(slot.color);
      return {
        name: slot.name,
        color: slot.color,
        human: true,
        difficulty: "medium",
        assist: !!slot.assist,
      };
    }
    let color = PALETTE.find((c) => !used.has(c.hex));
    if (!color) color = PALETTE[cpu % PALETTE.length];
    used.add(color.hex);
    const name = CPU_NAMES[cpu++] || `Gun ${cpu}`;
    return { name, color: color.hex, human: false, difficulty: slot.difficulty, assist: false };
  });
}

function begin() {
  const players = buildPlayers();
  const seed = Number(params.get("seed")) || Math.floor(Math.random() * 1e9);
  if (params.has("shop")) {
    match = createMatch({ mode, map: mapId, bestOf, seed, humanFO: false, players });
    match.phase = "roundend";
    match.roundWinner = match.players[0].id;
    for (const p of match.players) {
      p.lastPay = 160;
      p.cash = 240;
    }
    show("battle");
    renderBattle();
    return;
  }
  if (testMode && players.every((p) => !p.human)) {
    match = playCpuMatch({ mode, map: mapId, bestOf, seed, players });
    showVictory();
    return;
  }
  match = createMatch({
    mode,
    map: mapId,
    bestOf,
    seed,
    humanFO: mode === "observer" && humanFO,
    players,
  });
  show("battle");
  onTurn();
}

function nextAlive(m) {
  const i = m.shooterIndex ?? m.turnIndex;
  for (let k = 1; k <= m.players.length; k++) {
    const p = m.players[(i + k) % m.players.length];
    if (p.hp > 0) return p;
  }
  return null;
}

function onTurn() {
  if (!match) return;
  if (match.phase === "done") {
    showVictory();
    return;
  }
  if (match.phase === "roundend") {
    renderBattle();
    return;
  }
  if (match.phase === "shop") {
    shopStep();
    return;
  }
  if (match.phase === "aim") {
    const p = currentPlayer(match);
    if (p && !p.human) {
      // Let people see whose turn it is and watch the barrel swing before the CPU fires.
      renderBattle();
      const m = match;
      setTimeout(() => {
        if (match !== m || m.phase !== "aim" || currentPlayer(m) !== p) return;
        chooseShot(m);
        drainFx();
        draw();
        setTimeout(() => {
          if (match === m && m.phase === "aim" && currentPlayer(m) === p) shoot();
        }, 450);
      }, 550);
      return;
    }
  }
  renderBattle();
}

function shoot() {
  match.reveal = false;
  match.lookedAway = false;
  showImpact = false;
  if (impactHold) {
    clearTimeout(impactHold);
    impactHold = 0;
  }
  const res = fire(match);
  if (!res.ok) {
    say(res.reason);
    renderBattle();
    return;
  }
  shotSound();
  const path = match.lastFlight || [];
  if (!path.length || reduceMotion()) {
    flightAt = null;
    finishFlight();
    return;
  }
  // Every round plays at one pace, so a Roller visibly rolls and Cluster bomblets fall after the split.
  const subLen = Math.max(0, ...(match.lastSubs || []).map((sp) => sp.length));
  const total = path.length + subLen;
  const dur = Math.min(2800, Math.max(1100, total * 24));
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    flightAt = t * (total - 1);
    draw();
    if (t < 1) requestAnimationFrame(step);
    else finishFlight();
  };
  requestAnimationFrame(step);
}

function finishFlight() {
  commitFlight(match);
  flightAt = null;
  showImpact = !!(match.lastImpact && !match.lastImpact.off);
  if (match.pendingCallout !== "LOST" && !match.lastImpact?.off) boom();
  impactEffects();
  const line = match.pendingCallout || match.log[0] || "";
  if (line) say(line);
  draw();
  if (match.phase === "done") {
    showVictory();
    return;
  }
  if (match.phase === "roundend" || match.phase === "callout") {
    renderBattle();
    return;
  }
  if (match.phase === "handoff") {
    const nxt = nextAlive(match);
    renderBattle();
    // A callout has to stay on screen. Auto-advancing into a CPU turn would replace it before anyone reads it.
    // The pause keeps the impact ring up long enough to see where the shell landed.
    if (nxt && !nxt.human && !match.pendingCallout) {
      impactHold = window.setTimeout(() => {
        impactHold = 0;
        if (!match || match.phase !== "handoff") return;
        handoff(match);
        onTurn();
      }, 2400);
    }
  }
}

function shopStep() {
  if (match.phase !== "shop") {
    onTurn();
    return;
  }
  const p = match.players[match.shopIndex];
  if (!p.human) {
    cpuPurchase(match);
    shopDone(match);
    shopStep();
    return;
  }
  renderShop();
}

function windLabel(p) {
  if (p && p.blindWind) return "Wind hidden";
  if (!match.wind) return "Wind calm";
  const dir = match.wind > 0 ? "to the right" : "to the left";
  return `Wind ${Math.abs(match.wind)} m/s ${dir}`;
}

function renderHud() {
  const hud = document.querySelector("#hud");
  hud.replaceChildren();
  const scores = h("div", { id: "scores" });
  const p = currentPlayer(match);
  for (const g of match.players) {
    const s = h("span", { class: "score" + (g === p && match.phase === "aim" ? " up" : "") + (g.hp <= 0 ? " out" : "") });
    s.style.setProperty("--c", g.color);
    const dot = h("i", { class: "dot" });
    dot.style.background = g.color;
    const bar = h("i", { class: "hp" });
    const fill = h("b");
    fill.style.width = `${Math.max(0, g.hp)}%`;
    bar.append(fill);
    s.append(dot, h("span", { class: "nm", text: g.name }), bar, h("span", { class: "hpn", text: g.hp > 0 ? String(g.hp) : "out" }));
    if (g.score) s.append(h("span", { class: "wins", text: "★".repeat(g.score), "aria-label": `${g.score} rounds won` }));
    scores.append(s);
  }
  hud.append(scores);
  let turn;
  if (match.phase === "roundend") turn = `Round ${match.roundNumber} over`;
  else if (match.phase === "handoff" || match.phase === "callout" || match.phase === "flying") {
    const shooter = match.players[match.shooterIndex ?? match.turnIndex];
    turn = `${shooter ? shooter.name : "Nobody"} fired`;
  } else turn = `${p ? p.name : "Nobody"}'s turn`;
  hud.append(h("p", { id: "turn-line", text: `Round ${match.roundNumber} · best of ${match.bestOf} · ${turn}` }));
  hud.append(h("p", { id: "wind", class: "sr", text: windLabel(p) }));
  hud.append(button(isMuted() ? "Sound off" : "Sound on", { id: "mute", "aria-pressed": pressed(isMuted()) }, () => {
    toggleMute();
    renderHud();
  }));
  const bits = [`Round ${match.roundNumber}, best of ${match.bestOf}.`];
  for (const g of match.players) bits.push(`${g.name} ${g.hp > 0 ? g.hp : "out"}`);
  if (p) bits.push(`${p.name}'s turn. ${windLabel(p)}.`);
  if (match.pendingCallout) bits.push(match.pendingCallout);
  say(bits.join(" "));
}

function nudge(key, delta, min, max) {
  const p = currentPlayer(match);
  if (!p) return;
  p[key] = Math.max(min, Math.min(max, p[key] + delta));
  const node = document.querySelector(`#readout-${key}`);
  if (node) node.textContent = readout(key, p);
  draw();
}

// Arcade aim is shown as elevation (5–90°) plus a facing, so a gun on the right reads 58°, not 122°.
function elev(p) {
  return p.angle <= 90 ? p.angle : 180 - p.angle;
}

function nudgeElev(delta) {
  const p = currentPlayer(match);
  if (!p) return;
  const e = Math.max(5, Math.min(90, elev(p) + delta));
  p.angle = p.angle <= 90 ? e : 180 - e;
  const node = document.querySelector("#readout-angle");
  if (node) node.textContent = readout("angle", p);
  draw();
}

function readout(key, p) {
  if (key === "angle") return `${Math.round(elev(p))}° ${p.angle <= 90 ? "→" : "←"}`;
  if (key === "mils") return `${Math.round(p.mils)} mils`;
  if (key === "power") return String(p.power);
  if (key === "lateral") return p.lateral === 0 ? "On the line" : `${Math.abs(p.lateral)} m ${p.lateral > 0 ? "right" : "left"}`;
  if (key === "markX") return `Mark ${Math.round(p.markX)} m`;
  return "";
}

function renderPanel() {
  const panel = document.querySelector("#panel");
  panel.replaceChildren();
  const p = currentPlayer(match);

  if (match.phase === "roundend") {
    const w = match.players.find((g) => g.id === match.roundWinner);
    const result = h("div", { class: "result" });
    if (w) result.style.setProperty("--c", w.color);
    result.append(h("p", { id: "round-note", class: "result-big", text: w ? `${w.name} wins round ${match.roundNumber}!` : `Round ${match.roundNumber} is a draw` }));
    result.append(h("p", { text: match.players.map((g) => `${g.name} ${"★".repeat(g.score) || "–"}`).join("   ·   ") }));
    panel.append(result);
    panel.append(button("Shop", { id: "to-shop" }, () => {
      enterShop(match);
      shopStep();
    }));
    return;
  }

  if (match.phase === "callout" && match.lookedAway) {
    panel.append(h("p", { class: "callout", text: "Call the correction" }));
    for (const word of ["ADD", "DROP", "LEFT", "RIGHT"]) {
      const group = h("div", { class: "row", role: "group", "aria-label": word });
      const sizes = word === "LEFT" || word === "RIGHT" ? [100, 200] : [100, 200, 400, 800];
      for (const n of sizes) {
        group.append(button(`${word} ${n}`, { "data-corr": `${word} ${n}` }, () => finishCallout(`${word} ${n}`)));
      }
      panel.append(group);
    }
    panel.append(button("FIRE FOR EFFECT", { "data-corr": "FIRE FOR EFFECT" }, () => finishCallout("FIRE FOR EFFECT")));
    const input = h("input", { id: "fo-text", type: "text", maxlength: "80", "aria-label": "Type a correction" });
    panel.append(input);
    panel.append(button("Say this", { id: "fo-say" }, () => finishCallout(input.value.trim() || match.pendingCallout)));
    panel.append(button(`Use suggestion: ${match.pendingCallout}`, { id: "fo-suggest" }, () => finishCallout(match.pendingCallout)));
    return;
  }

  if (match.phase === "handoff") {
    const shooter = match.players[match.shooterIndex ?? match.turnIndex];
    const result = h("div", { class: "result" });
    result.append(h("p", { class: "result-big", text: resultLine(match) }));
    if (match.pendingCallout) {
      const call = h("p", { class: "callout" });
      call.append(document.createTextNode("Observer: "), h("b", { id: "callout", text: match.pendingCallout }));
      result.append(call);
    }
    if (match.log[0] && (match.lastHits || []).length) result.append(h("p", { id: "log", text: match.log[0] }));
    if (shooter) result.style.setProperty("--c", shooter.color);
    panel.append(result);
    const nxt = nextAlive(match);
    panel.append(button(nxt ? `Next: ${nxt.name} ▸` : "Next ▸", { id: "next" }, goNext));
    renderCard();
    return;
  }

  if (!p || !p.human || match.phase !== "aim") {
    panel.append(h("p", { class: "result-big", text: p ? `${p.name} is aiming…` : "Hold on" }));
    renderCard();
    return;
  }

  const who = h("div", { class: "who-chip" });
  who.style.setProperty("--c", p.color);
  who.append(h("span", { class: "cap", text: "Up" }), h("b", { text: p.name }));
  panel.append(who);
  if (match.skipNote) panel.append(h("p", { class: "skip-note", text: match.skipNote }));

  const owned = AMMO.filter((item) => item.id === "he" || (p.inv[item.id] || 0) > 0);
  if (!owned.some((item) => item.id === p.weapon)) p.weapon = "he";
  const weapons = group("Round", { role: "group", "aria-label": "Weapon" });
  for (const item of owned) {
    const node = iconButton(item.id, item.name, item.id === "he" ? "" : `×${p.inv[item.id]}`, { "data-weapon": item.id, title: item.hint, "aria-pressed": pressed(p.weapon === item.id) }, () => {
      p.weapon = item.id;
      renderPanel();
      draw();
    });
    weapons.append(node);
  }
  panel.append(weapons);

  const quick = QUICK.filter((item) => (p.inv[item.id] || 0) > 0);
  if (quick.length) {
    const box = group("Quick", { role: "group", "aria-label": "Quick items, don't end your turn" });
    for (const item of quick) {
      const node = iconButton(item.id, item.id === "repair" ? "Repair" : "Pop smoke", `×${p.inv[item.id]}`, { "data-quick": item.id, title: item.hint }, () => {
        const res = item.id === "repair" ? useRepair(match) : popSmoke(match);
        if (!res.ok) say(res.reason);
        drainFx();
        renderHud();
        renderPanel();
        draw();
      });
      if (item.id === "repair" && (p.repaired || p.hp >= 100)) node.disabled = true;
      if (item.id === "smoke" && match.smokes.some((sm) => sm.by === p.id)) node.disabled = true;
      box.append(node);
    }
    panel.append(box);
  }

  if (match.mode === "arcade") {
    const aim = group("Angle");
    aim.append(button("−5", { "aria-label": "Lower 5 degrees" }, () => nudgeElev(-5)));
    aim.append(button("−1", { "aria-label": "Lower 1 degree" }, () => nudgeElev(-1)));
    aim.append(h("span", { id: "readout-angle", class: "readout", text: readout("angle", p) }));
    aim.append(button("+1", { "aria-label": "Raise 1 degree" }, () => nudgeElev(1)));
    aim.append(button("+5", { "aria-label": "Raise 5 degrees" }, () => nudgeElev(5)));
    aim.append(button("Flip", { "aria-label": "Aim the other way" }, () => {
      p.angle = 180 - p.angle;
      renderPanel();
      draw();
    }));
    panel.append(aim);
    const slider = h("input", { id: "power", type: "range", min: "1", max: "100", step: "1", "aria-label": "Power", "aria-valuetext": `${p.power} power` });
    slider.value = String(p.power);
    slider.addEventListener("input", () => {
      p.power = Number(slider.value);
      slider.setAttribute("aria-valuetext", `${p.power} power`);
      const out = document.querySelector("#readout-power");
      if (out) out.textContent = readout("power", p);
      draw();
    });
    const power = group("Power");
    power.append(button("−", { "aria-label": "Power minus 1" }, () => {
      nudge("power", -1, 1, 100);
      slider.value = String(p.power);
    }));
    power.append(slider, h("span", { id: "readout-power", class: "readout", text: readout("power", p) }));
    power.append(button("+", { "aria-label": "Power plus 1" }, () => {
      nudge("power", 1, 1, 100);
      slider.value = String(p.power);
    }));
    panel.append(power);
    panel.append(button("Assist", { id: "assist", "aria-pressed": pressed(!!p.assist) }, () => {
      p.assist = !p.assist;
      renderPanel();
      draw();
    }));
  } else {
    if (match.mode === "observer") {
      const call = p.lastCall || p.targetCall || "";
      if (call) {
        const box = h("div", { class: "fo-call" });
        box.append(h("span", { class: "cap", text: p.lastCall ? "Last call" : "Observer" }), h("b", { id: "fo-last", text: call }));
        panel.append(box);
      }
    }
    const aim = group("Elevation");
    aim.append(button("−50", { "aria-label": "Elevation minus 50 mils" }, () => nudge("mils", -50, 0, 1600)));
    aim.append(button("−10", { "aria-label": "Elevation minus 10 mils" }, () => nudge("mils", -10, 0, 1600)));
    aim.append(h("span", { id: "readout-mils", class: "readout", text: readout("mils", p) }));
    aim.append(button("+10", { "aria-label": "Elevation plus 10 mils" }, () => nudge("mils", 10, 0, 1600)));
    aim.append(button("+50", { "aria-label": "Elevation plus 50 mils" }, () => nudge("mils", 50, 0, 1600)));
    panel.append(aim);
    const charges = group("Charge", { role: "group", "aria-label": "Charge" });
    for (let c = 1; c <= 7; c++) {
      charges.append(button(String(c), { class: "sq", "data-charge": String(c), "aria-label": `Charge ${c}`, "aria-pressed": pressed(p.charge === c) }, () => {
        p.charge = c;
        renderPanel();
        draw();
      }));
    }
    panel.append(charges);
    const face = group("Face");
    face.append(button("◀", { "aria-label": "Face left", "aria-pressed": pressed(p.facing < 0) }, () => {
      p.facing = -1;
      renderPanel();
      draw();
    }));
    face.append(button("▶", { "aria-label": "Face right", "aria-pressed": pressed(p.facing > 0) }, () => {
      p.facing = 1;
      renderPanel();
      draw();
    }));
    panel.append(face);
    if (match.mode === "observer") {
      const line = group("Line");
      line.append(button("◀ 25", { "aria-label": "Line left" }, () => nudge("lateral", -25, -200, 200)));
      line.append(h("span", { id: "readout-lateral", class: "readout", text: readout("lateral", p) }));
      line.append(button("25 ▶", { "aria-label": "Line right" }, () => nudge("lateral", 25, -200, 200)));
      panel.append(line);
    }
    panel.append(button("Range card", { id: "card-toggle", "aria-pressed": pressed(showCard) }, () => {
      showCard = !showCard;
      renderPanel();
    }));
  }

  if (p.weapon === "guided") {
    const mark = group("Mark");
    mark.append(button("◀", { "aria-label": "Mark left" }, () => nudge("markX", -20, 20, WORLD_W - 20)));
    mark.append(h("span", { id: "readout-markX", class: "readout", text: readout("markX", p) }));
    mark.append(button("▶", { "aria-label": "Mark right" }, () => nudge("markX", 20, 20, WORLD_W - 20)));
    panel.append(mark);
  }

  panel.append(button("Fire", { id: "fire" }, () => shoot()));
  const chosen = AMMO.find((a) => a.id === p.weapon);
  const keys = match.mode === "arcade" ? "Keys: ← → aim · ↑ ↓ power · Space fires" : "Keys: ← → mils · ↑ ↓ charge · Space fires";
  const tip = p.spotted ? "Flare up: your whole arc is showing. " : chosen && chosen.id !== "he" ? `${chosen.name}: ${chosen.hint} ` : "";
  panel.append(h("p", { class: "keys", text: `${tip}${keys}` }));
  renderCard();
}

function iconButton(id, label, count, attrs, onClick) {
  const node = h("button", { type: "button", class: "icon-btn", ...attrs });
  node.innerHTML = glyph(id);
  node.append(h("span", { text: label }));
  if (count) node.append(h("span", { class: "count", text: count }));
  node.addEventListener("click", onClick);
  return node;
}

function group(label, attrs = {}) {
  const node = h("div", { class: "grp", ...attrs });
  node.append(h("span", { class: "cap", text: label }));
  return node;
}

function renderCard() {
  const holder = document.querySelector("#rangecard");
  holder.replaceChildren();
  const p = currentPlayer(match);
  holder.hidden = !(match && match.mode !== "arcade" && showCard && match.phase === "aim" && p && p.human);
  if (!holder.hidden) holder.append(rangeTable());
}

function resultLine(m) {
  const hits = m.lastHits || [];
  if (m.lastImpact?.off) return "Off the map";
  const buried = (m.lastBuried || []).map((id) => m.players.find((g) => g.id === id)?.name).filter(Boolean);
  if (buried.length) return `Buried! ${buried.join(" and ")} ${buried.length > 1 ? "lose" : "loses"} a turn`;
  if (!hits.length) {
    if (m.lastWeapon === "illum") return m.map === "night" ? "The hill lights up" : "Flare up: your next arc shows in full";
    if (m.lastWeapon === "dirt") return "Dirt piled up";
    return m.mode === "observer" ? "Splash" : "Miss";
  }
  const shooterId = m.players[m.shooterIndex ?? m.turnIndex]?.id;
  const ko = hits.find((x) => x.killed);
  const self = hits.length === 1 && hits[0].id === shooterId;
  const names = hits.map((x) => `${m.players.find((g) => g.id === x.id)?.name} −${x.dealt}`).join(", ");
  if (ko) return `Knocked out! ${names}`;
  if (self) return `Own goal. ${names}`;
  return hits.some((x) => x.dealt >= 40) ? `Direct hit! ${names}` : `Hit! ${names}`;
}

function goNext() {
  if (!match || match.phase !== "handoff") return;
  if (impactHold) {
    clearTimeout(impactHold);
    impactHold = 0;
  }
  handoff(match);
  onTurn();
}

function rangeTable() {
  const card = rangeCard();
  const table = h("table");
  table.append(h("caption", { text: "Range card, flat ground, no wind (meters)" }));
  const head = h("tr");
  head.append(h("th", { text: "Ch" }));
  for (const mils of card.mils) head.append(h("th", { text: String(mils) }));
  const thead = h("thead");
  thead.append(head);
  table.append(thead);
  const body = h("tbody");
  for (const row of card.rows) {
    const tr = h("tr");
    tr.append(h("th", { text: String(row.charge) }));
    for (const cell of row.cells) tr.append(h("td", { text: cell.range == null ? "—" : String(cell.range) }));
    body.append(tr);
  }
  table.append(body);
  return table;
}

function finishCallout(text) {
  confirmCallout(match, text);
  match.reveal = false;
  say(match.pendingCallout);
  if (match.phase === "handoff") {
    const nxt = nextAlive(match);
    if (nxt && !nxt.human && !match.pendingCallout) {
      handoff(match);
      onTurn();
      return;
    }
  }
  renderBattle();
}

function renderBattle() {
  show("battle");
  document.querySelector("#battle").dataset.mode = match.mode;
  renderHud();
  renderPanel();
  resizeCanvas();
  if (match.phase === "callout" && !match.lookedAway && !dialog.open) dialog.showModal();
}

const KIND = { round: "Round", quick: "Quick use", gear: "Gear" };

function shopCard(p, item, kind) {
  const card = h("article", { class: "shop-card", "data-kind": kind });
  card.innerHTML = scene(item.id);
  const head = h("header");
  head.append(h("h3", { text: item.name }), h("span", { class: "price", text: `$${item.price}` }));
  card.append(head, h("p", { text: item.hint }));
  const foot = h("footer");
  let have = "";
  if (item.id === "armor") have = p.armor ? "Fitted" : "";
  else if (item.id === "shovel") have = p.shovelNext ? "Packed" : "";
  else if (p.inv[item.id]) have = `You have ${p.inv[item.id]}`;
  foot.append(h("span", { class: "kind", text: KIND[kind] }), h("span", { class: "have", text: have }));
  const node = button("Buy", { "data-buy": item.id, "aria-label": `Buy ${item.name}, $${item.price}` }, () => {
    const res = buy(match, item.id);
    if (!res.ok) {
      say(res.reason);
      return;
    }
    say(`Bought ${item.name}. $${match.players[match.shopIndex].cash} left.`);
    renderShop(item.id);
  });
  const owned = (item.id === "armor" && p.armor) || (item.id === "shovel" && p.shovelNext);
  if (p.cash < item.price || owned) node.disabled = true;
  if (owned) node.textContent = "Owned";
  foot.append(node);
  card.append(foot);
  return card;
}

function renderShop(justBought) {
  const root = document.querySelector("#shop");
  const p = match.players[match.shopIndex];
  root.replaceChildren();
  const top = h("div", { class: "shop-top" });
  const title = h("h1");
  title.append(document.createTextNode(`${p.name}'s shop`));
  top.append(title);
  const pay = p.caughtUp ? `Earned $${p.lastPay}, including the last-place bonus.` : `Earned $${p.lastPay} last round.`;
  top.append(h("p", { class: "shop-pay", text: `${pay} HE is always free.` }));
  const cash = h("p", { class: "cash", id: "cash" });
  cash.append(h("span", { class: "cap", text: "Cash" }), h("b", { text: `$${p.cash}` }));
  top.append(cash);
  top.append(button("Done", { id: "shop-done" }, () => {
    shopDone(match);
    shopStep();
  }));
  root.append(top);
  const grid = h("div", { class: "shop-grid" });
  for (const item of AMMO.filter((a) => a.price > 0)) grid.append(shopCard(p, item, "round"));
  for (const item of QUICK) grid.append(shopCard(p, item, "quick"));
  for (const item of GEAR) grid.append(shopCard(p, item, "gear"));
  root.append(grid);
  show("shop");
  if (justBought) {
    const card = root.querySelector(`[data-buy="${justBought}"]`)?.closest(".shop-card");
    card?.classList.add("bought");
    const again = root.querySelector(`[data-buy="${justBought}"]`);
    (again && !again.disabled ? again : root.querySelector("#shop-done"))?.focus();
  } else say(`${p.name}'s shop. $${p.cash}.`);
}

function showVictory() {
  const root = document.querySelector("#victory");
  const winner = match && winnerPlayer(match);
  root.replaceChildren();
  root.append(h("h1", { id: "winner-name", text: winner ? `${winner.name} wins the match` : "Draw" }));
  const scores = h("div", { class: "row" });
  for (const p of match.players) scores.append(h("p", { text: `${p.name} ${p.score}` }));
  root.append(scores);
  root.append(button("Play again", { id: "again" }, () => {
    match = null;
    renderSetup();
  }));
  show("victory");
  say(winner ? `${winner.name} wins the match` : "Draw");
  winSound();
}

function world(x, y) {
  const sx = (x / WORLD_W) * canvas.width;
  const sy = canvas.height - (y / VIEW_H) * canvas.height * 0.92 - canvas.height * 0.04;
  return [sx, sy];
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const hgt = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  draw();
}

function viewer() {
  if (!match) return null;
  if (match.phase === "flying" || match.phase === "callout" || match.phase === "handoff" || match.phase === "aim") {
    return currentPlayer(match);
  }
  return null;
}

function draw() {
  if (!match || !canvas.width) return;
  const w = canvas.width;
  const hgt = canvas.height;
  const now = performance.now();
  const night = match.map === "night" && match.light <= 0;
  const lit = match.map === "night" && match.light > 0;

  ctx.save();
  const shake = effects.find((e) => e.kind === "shake");
  if (shake && !reduceMotion()) {
    const k = 1 - (now - shake.t0) / shake.dur;
    ctx.translate((Math.random() * 2 - 1) * shake.mag * k, (Math.random() * 2 - 1) * shake.mag * k);
  }

  const sky = ctx.createLinearGradient(0, 0, 0, hgt);
  sky.addColorStop(0, night ? "#070b14" : lit ? "#1b2440" : "#6fa9d6");
  sky.addColorStop(1, night ? "#12182a" : lit ? "#3a4a38" : "#e9f4fb");
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, w + 40, hgt + 40);

  // Distant ridge for depth. Decoration only.
  ctx.fillStyle = night ? "#0c1220" : lit ? "#2a3550" : "rgba(92, 128, 150, 0.35)";
  ctx.beginPath();
  ctx.moveTo(0, hgt);
  for (let x = 0; x <= WORLD_W; x += 10) {
    const y = 250 + Math.sin(x / 130 + 1.3) * 40 + Math.sin(x / 47) * 12;
    const [sx, sy] = world(x, y);
    ctx.lineTo(sx, sy);
  }
  ctx.lineTo(w, hgt);
  ctx.closePath();
  ctx.fill();

  const dirt = night ? "#1a1f16" : lit ? "#4e5c32" : "#6b8f3c";
  const soil = night ? "#14170f" : lit ? "#3e3a24" : "#8a6a3f";
  const deep = night ? "#0e120c" : lit ? "#2c3820" : "#3d5a28";
  ctx.beginPath();
  const [x0, y0] = world(0, match.terrain[0]);
  ctx.moveTo(x0, hgt + 20);
  ctx.lineTo(x0, y0);
  for (let x = 1; x <= WORLD_W; x += 2) {
    const pt = world(x, match.terrain[x]);
    ctx.lineTo(pt[0], pt[1]);
  }
  const end = world(WORLD_W, match.terrain[WORLD_W]);
  ctx.lineTo(end[0], hgt + 20);
  ctx.closePath();
  const ground = ctx.createLinearGradient(0, hgt * 0.4, 0, hgt);
  ground.addColorStop(0, dirt);
  ground.addColorStop(1, soil);
  ctx.fillStyle = ground;
  ctx.fill();
  ctx.strokeStyle = deep;
  ctx.lineWidth = Math.max(3, w / 380);
  ctx.stroke();

  const who = viewer();
  const smokeAfter = [];
  for (const smoke of match.smokes) {
    // Your own smoke is see-through to you; everyone else gets a solid cloud, drawn over the guns.
    if (who && smoke.by === who.id) drawSmoke(smoke, w, hgt, 0.35);
    else smokeAfter.push(smoke);
  }

  // Each gun's last shot stays up as a dotted arc until it fires again, so it can walk the next one in.
  for (const g of match.players) {
    if (!g.trail || !g.trail.length || g.hp <= 0) continue;
    if (flightAt != null && g === currentPlayer(match)) continue;
    const mine = who && g === who;
    ctx.save();
    ctx.globalAlpha = mine ? 0.75 : 0.35;
    ctx.strokeStyle = g.color;
    ctx.lineWidth = mine ? Math.max(2.5, w / 640) : 2;
    ctx.setLineDash([Math.max(6, w / 240), Math.max(6, w / 240)]);
    ctx.beginPath();
    let started = false;
    for (const pt of g.trail) {
      if (who && hiddenX(who, pt.x)) break;
      if (who && g !== who && inSmoke(match, who.id, pt.x) && pt.y < (match.terrain[Math.round(pt.x)] || 0) + 60) break;
      const [sx, sy] = world(pt.x, pt.y);
      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      } else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  for (const g of match.players) {
    if (who && hiddenX(who, g.x)) continue;
    if (who && smokedOut(who, g.x) && g !== who) continue;
    drawGun(g, who, w, night);
  }
  for (const smoke of smokeAfter) drawSmoke(smoke, w, hgt, 0.92);

  if (who && who.human && match.phase === "aim" && who.weapon === "guided") drawMark(who, w);

  // A flare shows the whole arc for the next shot; Assist shows the first fifth.
  if (who && match.phase === "aim" && (who.spotted || (match.mode === "arcade" && who.assist))) {
    const shot = shotFrom(match, who, { trace: true });
    const preview = fly(match.terrain, match.players, shot, who.blindWind ? 0 : match.wind);
    const n = who.spotted ? preview.path.length : Math.max(2, Math.ceil(preview.path.length * 0.2));
    ctx.fillStyle = who.color;
    for (const pt of preview.path.slice(0, n)) {
      if (hiddenX(who, pt.x)) break;
      const [sx, sy] = world(pt.x, pt.y);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2.5, w / 700), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const path = match.lastFlight || [];
  if (flightAt != null && path.length) {
    const shooter = currentPlayer(match);
    const color = shooter ? shooter.color : "#241c14";
    drawTracer(path, Math.min(flightAt, path.length - 1), color, who, w, 1);
    if (flightAt > path.length - 1) {
      for (const sub of match.lastSubs || []) drawTracer(sub, Math.min(flightAt - path.length, sub.length - 1), color, who, w, 0.6);
    }
  }

  const ringHidden = who && match.lastImpact && inSmoke(match, who.id, match.lastImpact.x) && match.players[match.shooterIndex ?? -1] !== who;
  if (showImpact && match.lastImpact && !match.lastImpact.off && !ringHidden && !effects.some((e) => e.kind === "boom")) {
    const [ix, iy] = world(match.lastImpact.x, match.lastImpact.y);
    if (!who || !hiddenX(who, match.lastImpact.x)) {
      const ring = Math.max(14, w / 90);
      ctx.strokeStyle = "#fff3c4";
      ctx.lineWidth = Math.max(3, w / 600);
      ctx.beginPath();
      ctx.arc(ix, iy, ring, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawEffects(who, w, hgt, now);

  if (who && match.mode === "observer" && !match.reveal) {
    const enemy = nearestEnemy(match, who);
    if (enemy) {
      const line = maskLine(match.terrain, who.x, enemy.x);
      const [sx] = world(line, 0);
      ctx.fillStyle = night ? "rgba(8, 10, 8, 0.96)" : "rgba(28, 40, 22, 0.94)";
      const dir = Math.sign(enemy.x - who.x) || 1;
      if (dir > 0) ctx.fillRect(sx, -20, w - sx + 20, hgt + 40);
      else ctx.fillRect(-20, -20, sx + 20, hgt + 40);
      ctx.fillStyle = "rgba(244, 231, 207, 0.55)";
      ctx.font = `600 ${Math.round(w / 70)}px Palatino, Georgia, serif`;
      ctx.textAlign = "center";
      const mid = dir > 0 ? (sx + w) / 2 : sx / 2;
      ctx.fillText("Past your ridge: only the observer can see", mid, hgt * 0.35);
    }
  }

  drawWind(w, hgt, who);
  ctx.restore();
}

function drawSmoke(smoke, w, hgt, alpha) {
  const base = (match.terrain[Math.round(smoke.x)] || 0) + 8;
  const rx = (smoke.r / WORLD_W) * w;
  const t = performance.now() / 1000;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const [dx, dy, k] of [[-0.55, 10, 0.5], [0.5, 12, 0.5], [0, 26, 0.62], [-0.3, 40, 0.45], [0.32, 38, 0.42], [0, 6, 0.55]]) {
    const [sx, sy] = world(smoke.x + dx * smoke.r * 0.8, base + dy);
    ctx.fillStyle = k > 0.5 ? "#9a9a96" : "#86867f";
    ctx.beginPath();
    ctx.arc(sx + Math.sin(t * 0.6 + dx * 5) * rx * 0.03, sy, rx * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTracer(path, at, color, who, w, size) {
  const end = Math.floor(at);
  if (end < 0) return;
  ctx.save();
  ctx.lineWidth = Math.max(2, (w / 640) * size);
  ctx.strokeStyle = color;
  ctx.beginPath();
  let started = false;
  let under = false;
  for (let i = 0; i <= end; i++) {
    const pt = path[i];
    if (who && hiddenX(who, pt.x)) break;
    if (pt.under && !under) {
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(48, 34, 18, 0.9)";
      ctx.setLineDash([Math.max(4, w / 300), Math.max(4, w / 300)]);
      started = false;
      under = true;
    }
    const [sx, sy] = world(pt.x, pt.y);
    if (!started) {
      ctx.moveTo(sx, sy);
      started = true;
    } else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.restore();
  const head = path[end];
  if (!head || (who && hiddenX(who, head.x))) return;
  const [sx, sy] = world(head.x, head.y);
  ctx.save();
  ctx.fillStyle = head.under ? "rgba(27, 21, 16, 0.55)" : "#1b1510";
  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(3, (w / 320) * size), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMark(p, w) {
  const x = p.markX;
  const [sx, sy] = world(x, (match.terrain[Math.round(x)] || 0) + 14);
  const r = Math.max(10, w / 110);
  ctx.save();
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(2.5, w / 600);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.moveTo(sx, sy - r * 1.7);
  ctx.lineTo(sx, sy - r * 0.5);
  ctx.moveTo(sx, sy + r * 0.5);
  ctx.lineTo(sx, sy + r * 1.7);
  ctx.moveTo(sx - r * 1.7, sy);
  ctx.lineTo(sx - r * 0.5, sy);
  ctx.moveTo(sx + r * 0.5, sy);
  ctx.lineTo(sx + r * 1.7, sy);
  ctx.stroke();
  ctx.restore();
}

// Quick items (repair, smoke) leave notes in match.fx; show them and clear the queue.
function drainFx() {
  if (!match || !match.fx) return;
  for (const f of match.fx.splice(0)) {
    if (f.kind === "heal") {
      addEffect({ kind: "num", x: f.x, y: f.y + 42, text: `+${f.amount}`, color: "#7ee08f", big: true, dur: 1600 });
      say(`${match.players.find((g) => g.id === f.id)?.name} patches up +${f.amount}`);
    } else if (f.kind === "smoke") {
      addEffect({ kind: "puff", x: f.x, y: f.y + 20, r: 70, color: "#9a9a96", dur: 1100 });
      say(`${match.players.find((g) => g.id === f.id)?.name} pops smoke`);
    }
  }
}

function drawGun(g, who, w, night) {
  const [sx, sy] = world(g.x, g.y);
  const u = Math.max(7, (7 / WORLD_W) * w);
  const dead = g.hp <= 0;
  const body = dead ? "#5d5852" : night && g !== who ? "#1c2218" : g.color;
  ctx.save();
  // Tracks
  ctx.fillStyle = dead ? "#3b3732" : "#2a231b";
  ctx.beginPath();
  ctx.roundRect(sx - 1.7 * u, sy - 0.75 * u, 3.4 * u, 0.85 * u, 0.42 * u);
  ctx.fill();
  ctx.fillStyle = "#5a5046";
  for (let k = -1.2; k <= 1.21; k += 0.6) {
    ctx.beginPath();
    ctx.arc(sx + k * u, sy - 0.33 * u, 0.2 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  // Hull and turret
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(sx - 1.45 * u, sy - 1.45 * u, 2.9 * u, 0.8 * u, 0.25 * u);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx, sy - 1.45 * u, 0.85 * u, Math.PI, 0);
  ctx.fill();
  if (!dead) {
    const ang = barrel(g);
    const bx = sx;
    const by = sy - 1.7 * u;
    ctx.strokeStyle = night && g !== who ? "#141810" : "#2a231b";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.42 * u;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(ang) * 2.3 * u, by - Math.sin(ang) * 2.3 * u);
    ctx.stroke();
    if (g.buried) {
      ctx.fillStyle = "#8a6a3f";
      ctx.strokeStyle = "#5c4422";
      ctx.lineWidth = Math.max(2, u * 0.2);
      ctx.beginPath();
      ctx.moveTo(sx - 2.6 * u, sy);
      ctx.quadraticCurveTo(sx - 1.6 * u, sy - 3.4 * u, sx, sy - 3.3 * u);
      ctx.quadraticCurveTo(sx + 1.6 * u, sy - 3.4 * u, sx + 2.6 * u, sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = "rgba(60, 56, 52, 0.55)";
    ctx.beginPath();
    ctx.arc(sx - 0.4 * u, sy - 2.6 * u, 0.7 * u, 0, Math.PI * 2);
    ctx.arc(sx + 0.3 * u, sy - 3.4 * u, 0.55 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (night && g !== who && !dead) return;
  // Name tag and health bar
  const tagY = sy - 4.1 * u;
  const barW = 4.2 * u;
  ctx.save();
  ctx.font = `700 ${Math.round(Math.max(13, u * 1.25))}px Palatino, Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = Math.max(3, u * 0.35);
  ctx.strokeStyle = "rgba(20, 16, 12, 0.75)";
  ctx.strokeText(g.name, sx, tagY - 0.25 * u);
  ctx.fillStyle = dead ? "#cfc6ba" : "#fffaf0";
  ctx.fillText(g.name, sx, tagY - 0.25 * u);
  if (!dead) {
    ctx.fillStyle = "rgba(20, 16, 12, 0.7)";
    ctx.beginPath();
    ctx.roundRect(sx - barW / 2, tagY, barW, 0.55 * u, 0.25 * u);
    ctx.fill();
    ctx.fillStyle = g.hp > 50 ? "#5bd17a" : g.hp > 25 ? "#f2c14e" : "#ef5b4c";
    ctx.beginPath();
    ctx.roundRect(sx - barW / 2 + 1.5, tagY + 1.5, Math.max(0, (barW - 3) * (g.hp / 100)), 0.55 * u - 3, 0.2 * u);
    ctx.fill();
  }
  const up = currentPlayer(match);
  if (!dead && up === g && match.phase === "aim") {
    const ay = tagY - 1.9 * u;
    ctx.fillStyle = g.color;
    ctx.strokeStyle = "#fffaf0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 0.7 * u, ay - 0.9 * u);
    ctx.lineTo(sx + 0.7 * u, ay - 0.9 * u);
    ctx.lineTo(sx, ay);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawWind(w, hgt, who) {
  const cx = w / 2;
  const cy = Math.max(34, hgt * 0.06);
  const blind = who && who.blindWind;
  const wind = match.wind;
  ctx.save();
  ctx.fillStyle = "rgba(20, 16, 12, 0.55)";
  const boxW = Math.max(220, w / 7);
  const boxH = Math.max(46, hgt / 16);
  ctx.beginPath();
  ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, boxH / 2);
  ctx.fill();
  ctx.fillStyle = "#fffaf0";
  ctx.font = `700 ${Math.round(boxH * 0.42)}px Palatino, Georgia, serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  if (blind) {
    ctx.fillText("Wind hidden by smoke", cx, cy);
  } else if (!wind) {
    ctx.fillText("Wind calm", cx, cy);
  } else {
    const dir = Math.sign(wind);
    ctx.textAlign = "right";
    ctx.fillText(`Wind ${Math.abs(wind)}`, cx - boxW * 0.04, cy);
    const ax = cx + boxW * 0.22;
    const len = Math.max(boxH * 0.4, (Math.abs(wind) / 6) * boxW * 0.34);
    ctx.strokeStyle = "#ffd27a";
    ctx.fillStyle = "#ffd27a";
    ctx.lineWidth = Math.max(4, boxH * 0.12);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ax - (dir * len) / 2, cy);
    ctx.lineTo(ax + (dir * len) / 2, cy);
    ctx.stroke();
    const tip = ax + (dir * len) / 2;
    ctx.beginPath();
    ctx.moveTo(tip + dir * boxH * 0.2, cy);
    ctx.lineTo(tip - dir * boxH * 0.12, cy - boxH * 0.24);
    ctx.lineTo(tip - dir * boxH * 0.12, cy + boxH * 0.24);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawEffects(who, w, hgt, now) {
  for (const e of effects) {
    if (e.kind === "shake") continue;
    if (who && hiddenX(who, e.x)) continue;
    const t = Math.min(1, (now - e.t0) / e.dur);
    const [sx, sy] = world(e.x, e.y);
    if (e.kind === "boom") {
      const r = (e.r / WORLD_W) * w;
      const grow = 0.35 + 0.65 * Math.sqrt(t);
      ctx.save();
      ctx.globalAlpha = 1 - t;
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * grow);
      glow.addColorStop(0, "#fff6c8");
      glow.addColorStop(0.35, "#ffb02e");
      glow.addColorStop(0.75, "#e2531d");
      glow.addColorStop(1, "rgba(120, 40, 10, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, r * grow, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (e.kind === "puff") {
      const r = (e.r / WORLD_W) * w;
      ctx.save();
      ctx.globalAlpha = 0.7 * (1 - t);
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(sx, sy - t * r * 0.6, r * (0.5 + t * 0.7), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (e.kind === "bit") {
      const age = (now - e.t0) / 1000;
      const x = e.x + e.vx * age;
      const y = e.y + e.vy * age - 0.5 * 140 * age * age;
      const [bx, by] = world(x, y);
      ctx.fillStyle = e.color;
      ctx.globalAlpha = 1 - t;
      ctx.fillRect(bx - 3, by - 3, 6, 6);
      ctx.globalAlpha = 1;
    } else if (e.kind === "num") {
      const rise = t * hgt * 0.06;
      ctx.save();
      ctx.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      ctx.font = `800 ${Math.round(w / (e.big ? 34 : 48))}px Palatino, Georgia, serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = Math.max(4, w / 400);
      ctx.strokeStyle = "rgba(20, 16, 12, 0.85)";
      ctx.strokeText(e.text, sx, sy - rise);
      ctx.fillStyle = e.color;
      ctx.fillText(e.text, sx, sy - rise);
      ctx.restore();
    }
  }
}

function addEffect(e) {
  effects.push({ ...e, t0: performance.now() });
  if (!animating) {
    animating = true;
    requestAnimationFrame(tick);
  }
}

function tick(now) {
  effects = effects.filter((e) => now - e.t0 < e.dur);
  draw();
  if (effects.length) requestAnimationFrame(tick);
  else {
    animating = false;
    draw();
  }
}

function impactEffects() {
  const imp = match.lastImpact;
  const weapon = match.lastWeapon || "he";
  const slow = reduceMotion();
  if (imp && !imp.off) {
    if (weapon === "dirt") {
      addEffect({ kind: "puff", x: imp.x, y: imp.y, r: 46, color: "#8a6a3f", dur: 1000 });
      if (!slow) for (let k = 0; k < 16; k++) addEffect({ kind: "bit", x: imp.x, y: imp.y + 20, vx: (Math.random() * 2 - 1) * 50, vy: 30 + Math.random() * 80, color: "#6b5130", dur: 1000 });
    } else if (weapon === "illum") {
      addEffect({ kind: "puff", x: imp.x, y: imp.y + 160, r: 60, color: "#fff4b0", dur: 1600 });
    }
  }
  for (const b of match.lastBursts || []) {
    addEffect({ kind: "boom", x: b.x, y: b.y, r: b.r * 0.85, dur: slow ? 300 : 650 });
    if (slow) continue;
    const bits = b.r > 50 ? 18 : b.r < 32 ? 5 : 10;
    for (let k = 0; k < bits; k++) {
      addEffect({
        kind: "bit",
        x: b.x,
        y: b.y,
        vx: (Math.random() * 2 - 1) * 60,
        vy: 40 + Math.random() * 90,
        color: Math.random() < 0.5 ? "#6b5130" : "#3d5a28",
        dur: 900,
      });
    }
  }
  if (weapon === "big" && (match.lastBursts || []).length) addEffect({ kind: "shake", x: 0, y: 0, mag: 10, dur: 420 });
  for (const id of match.lastBuried || []) {
    const g = match.players.find((p) => p.id === id);
    if (g) addEffect({ kind: "num", x: g.x, y: g.y + 58, text: "Buried!", color: "#e8c48a", big: true, dur: 2000 });
  }
  for (const hit of match.lastHits || []) {
    const g = match.players.find((p) => p.id === hit.id);
    addEffect({
      kind: "num",
      x: hit.x,
      y: hit.y + 42,
      text: hit.killed ? `KO! −${hit.dealt}` : `−${hit.dealt}`,
      color: hit.killed ? "#ffd27a" : "#ff8a7a",
      big: hit.dealt >= 40 || hit.killed,
      dur: 1800,
    });
    if (g && (hit.dealt >= 30 || hit.killed)) addEffect({ kind: "shake", x: 0, y: 0, mag: hit.killed ? 14 : 8, dur: 380 });
  }
}

function barrel(p) {
  if (match.mode === "arcade") return (p.angle * Math.PI) / 180;
  const rad = (p.mils / 6400) * Math.PI * 2;
  return p.facing >= 0 ? rad : Math.PI - rad;
}

function hiddenX(who, x) {
  if (match.mode !== "observer" || match.reveal) return false;
  const enemy = nearestEnemy(match, who);
  if (!enemy) return false;
  const line = maskLine(match.terrain, who.x, enemy.x);
  const dir = Math.sign(enemy.x - who.x) || 1;
  return (x - line) * dir > 0;
}

function smokedOut(who, x) {
  return inSmoke(match, who.id, x);
}

function onKey(e) {
  if (e.target.closest("input, textarea")) return;
  if (match && (match.phase === "handoff" || match.phase === "roundend") && (e.key === " " || e.key === "Enter")) {
    if (e.target.closest("button")) return;
    e.preventDefault();
    if (match.phase === "handoff") goNext();
    else document.querySelector("#to-shop")?.click();
    return;
  }
  if (!match || match.phase !== "aim") return;
  const p = currentPlayer(match);
  if (!p || !p.human) return;
  const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  if (arrows.includes(e.key)) e.preventDefault();
  if (match.mode === "arcade") {
    // Arrows turn the barrel the way they point.
    if (e.key === "ArrowLeft") nudge("angle", 1, 5, 175);
    else if (e.key === "ArrowRight") nudge("angle", -1, 5, 175);
    else if (e.key === "ArrowUp") nudge("power", 1, 1, 100);
    else if (e.key === "ArrowDown") nudge("power", -1, 1, 100);
  } else {
    if (e.key === "ArrowLeft") nudge("mils", -10, 0, 1600);
    else if (e.key === "ArrowRight") nudge("mils", 10, 0, 1600);
    else if (e.key === "ArrowUp") p.charge = Math.min(7, p.charge + 1);
    else if (e.key === "ArrowDown") p.charge = Math.max(1, p.charge - 1);
    if (e.key === "ArrowUp" || e.key === "ArrowDown") renderPanel();
  }
  if (e.key === " " || e.key === "Enter") {
    if (e.target.closest("button")) return;
    e.preventDefault();
    shoot();
  }
}

export function boot() {
  applySettings(loadSettings());
  dialog.addEventListener("close", () => {
    if (!match || match.phase !== "callout" || match.lookedAway) return;
    match.lookedAway = true;
    match.reveal = true;
    renderBattle();
  });
  document.addEventListener("keydown", onKey);
  new ResizeObserver(() => {
    if (!document.querySelector("#battle").hidden) resizeCanvas();
  }).observe(canvas);
  window.__fm = {
    get match() {
      return match;
    },
    get phase() {
      return match ? match.phase : null;
    },
  };
  renderSetup();
}
