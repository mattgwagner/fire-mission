// Hand-drawn SVG for the shop cards and the round buttons. Static strings, no user input.
// Scenes are 160x96; parts with class "fx" animate when the card is hovered or focused.

const TANK = (x, y, c, flip = false, s = 1) => `
  <g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
    <rect x="-11" y="-5" width="22" height="6" rx="3" fill="#2a231b"/>
    <circle cx="-7" cy="-2" r="1.4" fill="#5a5046"/><circle cx="-2.5" cy="-2" r="1.4" fill="#5a5046"/>
    <circle cx="2.5" cy="-2" r="1.4" fill="#5a5046"/><circle cx="7" cy="-2" r="1.4" fill="#5a5046"/>
    <rect x="-9.5" y="-10" width="19" height="5.5" rx="1.8" fill="${c}"/>
    <path d="M-5.5 -10 a5.5 5.5 0 0 1 11 0z" fill="${c}"/>
    <line x1="0" y1="-12" x2="10" y2="-19" stroke="#2a231b" stroke-width="2.6" stroke-linecap="round"/>
  </g>`;

const SKY = (top, bottom) => `
  <rect width="160" height="96" fill="${bottom}"/>
  <rect width="160" height="60" fill="${top}" opacity="0.55"/>`;

const DAY = SKY("#6fa9d6", "#cfe6f4");
const GROUND = (d, fill = "#6b8f3c", edge = "#3d5a28") => `<path d="${d}" fill="${fill}" stroke="${edge}" stroke-width="2"/>`;
const ARC = (d, c = "#fff8e6") => `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round"/>`;
const SHELL = (x, y, rot, c = "#2a231b", band = "#e0a106", s = 1) => `
  <g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <path d="M-7 -3 h9 q6 0 8 3 q-2 3 -8 3 h-9z" fill="${c}"/>
    <rect x="-3" y="-3" width="2.4" height="6" fill="${band}"/>
  </g>`;
const BOOM = (x, y, r) => `
  <g class="fx boom" style="transform-origin:${x}px ${y}px">
    <circle cx="${x}" cy="${y}" r="${r}" fill="#e2531d" opacity="0.85"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.68}" fill="#ffb02e"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.32}" fill="#fff6c8"/>
  </g>`;

const FLAT = "M0 78 C40 74 80 80 120 76 S160 78 160 78 V96 H0z";

const SCENES = {
  he: `${DAY}${GROUND(FLAT)}${ARC("M18 70 Q70 -4 124 66")}${TANK(18, 76, "#d6453d")}${BOOM(128, 74, 9)}${TANK(132, 77, "#2f6fed", true)}`,

  big: `${DAY}${GROUND("M0 80 C30 76 70 80 96 80 Q118 92 140 80 C150 78 156 78 160 78 V96 H0z")}
    ${ARC("M14 72 Q60 -6 112 66")}${TANK(14, 79, "#d6453d")}
    ${BOOM(118, 78, 17)}
    <g class="fx debris"><rect x="98" y="52" width="4" height="4" fill="#6b5130"/><rect x="134" y="48" width="4" height="4" fill="#3d5a28"/><rect x="116" y="42" width="3" height="3" fill="#6b5130"/></g>
    ${SHELL(106, 56, 62, "#2a231b", "#d6453d", 1.5)}`,

  cluster: `${DAY}${GROUND(FLAT)}${ARC("M14 70 Q46 10 80 16")}${TANK(14, 76, "#d6453d")}
    <circle cx="80" cy="16" r="5" fill="#fff6c8" opacity="0.9"/>
    <g class="fx drop">
      ${ARC("M80 18 Q88 40 94 70", "#ffe9b0")}${ARC("M80 18 Q104 34 120 70", "#ffe9b0")}${ARC("M80 18 Q120 30 146 70", "#ffe9b0")}
      ${ARC("M80 18 Q76 40 70 70", "#ffe9b0")}
      <circle cx="88" cy="44" r="2.6" fill="#2a231b"/><circle cx="102" cy="38" r="2.6" fill="#2a231b"/>
      <circle cx="118" cy="36" r="2.6" fill="#2a231b"/><circle cx="76" cy="46" r="2.6" fill="#2a231b"/>
    </g>
    ${BOOM(70, 74, 5)}${BOOM(94, 76, 5)}${BOOM(120, 75, 5)}${BOOM(146, 75, 5)}${TANK(118, 77, "#2f6fed", true)}`,

  roller: `${DAY}${GROUND("M0 34 C30 34 46 40 70 62 S110 84 122 84 S150 80 160 70 V96 H0z")}
    ${TANK(16, 35, "#d6453d")}
    ${ARC("M40 38 Q50 44 62 54 T100 80", "#fff8e6")}
    <g class="fx roll"><circle cx="78" cy="68" r="5" fill="#2a231b"/><path d="M75 66 l6 4 M78 64 v8" stroke="#e0a106" stroke-width="1.6"/>
    <path d="M64 58 h-8 M66 63 h-10" stroke="#fff8e6" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/></g>
    ${TANK(124, 85, "#2f6fed", true)}`,

  burrower: `${DAY}${GROUND("M0 80 C20 80 40 76 56 56 Q72 30 92 52 C104 66 120 80 160 80 V96 H0z")}
    <path d="M0 96 V86 H160 V96z" fill="#8a6a3f" opacity="0.6"/>
    ${ARC("M12 72 Q30 30 50 66")}${TANK(12, 79, "#d6453d")}
    <path class="fx tunnel" d="M50 66 C66 76 100 82 128 84" fill="none" stroke="#3b2b17" stroke-width="3.2" stroke-dasharray="5 4" stroke-linecap="round"/>
    ${BOOM(130, 82, 10)}${TANK(132, 80, "#2f6fed", true)}
    <g transform="translate(98 80) rotate(10)"><path d="M-7 -3 h8 l6 3 l-6 3 h-8z" fill="#2a231b"/><path d="M1 -3 l6 3 l-6 3" fill="#c0c4c8"/></g>`,

  dirt: `${DAY}${GROUND(FLAT)}${ARC("M14 70 Q66 0 112 54")}${TANK(14, 76, "#d6453d")}
    ${TANK(118, 76, "#2f6fed", true)}
    <path class="fx pile" style="transform-origin:118px 78px" d="M92 79 Q100 56 118 54 Q136 56 144 79z" fill="#8a6a3f" stroke="#5c4422" stroke-width="2"/>
    <g fill="#6b5130"><circle cx="106" cy="50" r="3"/><circle cx="130" cy="46" r="2.4"/><circle cx="120" cy="40" r="2"/></g>
    <text x="118" y="70" text-anchor="middle" font-size="10" font-weight="800" fill="#fff8e6" font-family="Georgia,serif">SKIP</text>`,

  illum: `${SKY("#070b14", "#1b2440")}${GROUND(FLAT, "#2a3a22", "#0e120c")}
    <circle cx="96" cy="22" r="34" fill="#fff4b0" opacity="0.14" class="fx glow" style="transform-origin:96px 22px"/>
    <path d="M88 10 q8 -8 16 0z" fill="#e9e2cf"/><path d="M88 10 L96 20 L104 10" stroke="#e9e2cf" stroke-width="0.8" fill="none"/>
    <circle cx="96" cy="21" r="3.4" fill="#fff6c8"/>
    ${ARC("M16 70 Q70 -2 124 70", "#ffd27a")}${TANK(16, 76, "#d6453d")}${TANK(128, 77, "#2f6fed", true)}`,

  guided: `${DAY}${GROUND(FLAT)}${ARC("M14 70 Q54 4 88 30 Q112 48 120 68", "#fff8e6")}
    ${ARC("M88 30 Q104 40 150 60", "#fff8e6")}
    <path d="M150 60 l-6 -1 M150 60 l-3 -5" stroke="#d6453d" stroke-width="2.2" stroke-linecap="round"/>
    ${TANK(14, 76, "#d6453d")}${TANK(122, 77, "#2f6fed", true)}
    <g class="fx mark" style="transform-origin:122px 62px" stroke="#ffd27a" stroke-width="2.2" fill="none">
      <circle cx="122" cy="62" r="9"/><path d="M122 49 v7 M122 68 v7 M109 62 h7 M128 62 h7"/></g>
    ${SHELL(98, 40, 34, "#2a231b", "#2f6fed")}`,

  repair: `${DAY}${GROUND(FLAT)}${TANK(80, 77, "#1f8a5b", false, 1.7)}
    <g class="fx heal" style="transform-origin:80px 30px">
      <circle cx="80" cy="30" r="15" fill="#fffaf0" stroke="#1f8a5b" stroke-width="3"/>
      <path d="M80 21 v18 M71 30 h18" stroke="#1f8a5b" stroke-width="5" stroke-linecap="round"/></g>
    <text x="114" y="34" font-size="16" font-weight="800" fill="#1f8a5b" font-family="Georgia,serif">+35</text>
    <path d="M30 50 l12 -12 m-3 -3 a5 5 0 1 0 6 6" stroke="#5a5046" stroke-width="4" stroke-linecap="round" fill="none"/>`,

  smoke: `${DAY}${GROUND(FLAT)}${ARC("M16 68 Q60 0 100 44", "#fff8e6")}
    <text x="102" y="36" font-size="18" font-weight="800" fill="#2a231b" font-family="Georgia,serif">?</text>
    ${TANK(16, 76, "#d6453d")}${TANK(122, 77, "#2f6fed", true)}
    <g class="fx cloud" fill="#8f8f8f">
      <circle cx="108" cy="66" r="15" opacity="0.88"/><circle cx="126" cy="58" r="18" opacity="0.9"/>
      <circle cx="144" cy="66" r="14" opacity="0.88"/><circle cx="124" cy="74" r="16" opacity="0.92"/></g>`,

  armor: `${DAY}${GROUND(FLAT)}${TANK(70, 77, "#2f6fed", false, 1.7)}
    <path d="M118 22 l20 7 v14 c0 14 -10 22 -20 26 c-10 -4 -20 -12 -20 -26 v-14z" fill="#c9ced4" stroke="#5a6470" stroke-width="2.4"/>
    <path d="M110 44 l6 6 l12 -13" stroke="#1f8a5b" stroke-width="4" fill="none" stroke-linecap="round"/>
    <g class="fx ping">${SHELL(30, 30, 30, "#2a231b", "#d6453d")}<path d="M42 44 l6 -2 M44 50 l7 1" stroke="#fff8e6" stroke-width="2" stroke-linecap="round"/></g>`,

  shovel: `${DAY}${GROUND("M0 74 H58 Q62 86 80 86 Q98 86 102 74 H160 V96 H0z")}
    ${TANK(80, 86, "#e0a106", false, 1.5)}
    <path d="M56 74 q-6 -8 -16 -6 M104 74 q6 -8 16 -6" stroke="#5c4422" stroke-width="3" fill="none"/>
    <g transform="rotate(-24 128 50)"><g class="fx dig" style="transform-origin:128px 66px">
      <rect x="126" y="24" width="4" height="30" rx="1.5" fill="#8a6a3f"/><rect x="121" y="20" width="14" height="5" rx="2" fill="#8a6a3f"/>
      <path d="M120 54 h16 v8 q-8 8 -16 0z" fill="#9aa1a8" stroke="#5a6470" stroke-width="1.5"/></g></g>`,
};

export function scene(id) {
  const body = SCENES[id] || SCENES.he;
  return `<svg viewBox="0 0 160 96" role="presentation" aria-hidden="true" focusable="false">${body}</svg>`;
}

// Small round-button icons, 24x24, drawn in currentColor where it helps contrast.
const GLYPHS = {
  he: `<path d="M3 9.5 h11 q6 0 8 2.5 q-2 2.5 -8 2.5 h-11z" fill="currentColor"/><rect x="7" y="9.5" width="2" height="5" fill="#e0a106"/>`,
  big: `<path d="M1.5 7.5 h11 q8 0 10 4.5 q-2 4.5 -10 4.5 h-11z" fill="currentColor"/><rect x="6" y="7.5" width="2.6" height="9" fill="#d6453d"/>`,
  cluster: `<circle cx="12" cy="5" r="3" fill="currentColor"/><circle cx="5" cy="16" r="2.4" fill="currentColor"/><circle cx="12" cy="19" r="2.4" fill="currentColor"/><circle cx="19" cy="16" r="2.4" fill="currentColor"/><path d="M11 8 L6 13 M12 8 v8 M13 8 l5 5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.6 1.6"/>`,
  roller: `<path d="M1 6 Q9 8 14 18 H23" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="15" cy="14.5" r="4" fill="currentColor"/><path d="M13 12.5 l4 4" stroke="#e0a106" stroke-width="1.4"/>`,
  burrower: `<path d="M1 8 H23" stroke="#8a6a3f" stroke-width="2.2"/><path d="M3 13 h11 l7 3 l-7 3 h-11z" fill="currentColor"/><path d="M14 13 l7 3 l-7 3" fill="#9aa1a8"/>`,
  dirt: `<path d="M2 20 Q6 7 12 7 Q18 7 22 20z" fill="#8a6a3f" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="5" r="1.6" fill="currentColor"/><circle cx="17" cy="4" r="1.3" fill="currentColor"/>`,
  illum: `<path d="M6 7 q6 -6 12 0z" fill="currentColor"/><path d="M6 7 L12 14 L18 7" stroke="currentColor" stroke-width="1" fill="none"/><circle cx="12" cy="16" r="3.6" fill="#f2c14e" stroke="currentColor" stroke-width="1"/>`,
  guided: `<circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 1 v6 M12 17 v6 M1 12 h6 M17 12 h6" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.8" fill="#d6453d"/>`,
  repair: `<rect x="3" y="3" width="18" height="18" rx="4" fill="#1f8a5b"/><path d="M12 7 v10 M7 12 h10" stroke="#fffaf0" stroke-width="3" stroke-linecap="round"/>`,
  smoke: `<g fill="currentColor" opacity="0.85"><circle cx="8" cy="14" r="5"/><circle cx="14" cy="10" r="6"/><circle cx="17" cy="15" r="4.5"/></g>`,
};

export function glyph(id) {
  const body = GLYPHS[id] || GLYPHS.he;
  return `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}
