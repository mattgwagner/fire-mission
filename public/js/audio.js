let ctx = null;
let muted = false;

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  return muted;
}

export function unlock() {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq, dur, type, gain) {
  if (!ctx || muted) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(gain, now);
  amp.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur);
}

export function shotSound() {
  unlock();
  tone(720, 0.22, "sawtooth", 0.03);
  tone(220, 0.35, "sine", 0.06);
}

export function boom() {
  tone(78, 0.4, "sine", 0.18);
  tone(140, 0.18, "triangle", 0.05);
}

export function winSound() {
  tone(523, 0.12, "sine", 0.06);
  tone(659, 0.12, "sine", 0.05);
  tone(784, 0.28, "sine", 0.06);
}
