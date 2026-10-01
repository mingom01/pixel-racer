// 간단한 칩튠 효과음 (WebAudio)
let ctx = null, master = null, eng = null;
let volume = 0.6;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    // 엔진: 톱니파 + 저역통과
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square';
    f.type = 'lowpass'; f.frequency.value = 500;
    g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start();
    eng = { o1, o2, f, g };
  } catch (e) { ctx = null; }
}
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }

export function engine(speedRatio, throttle, on) {
  if (!eng) return;
  if (!Number.isFinite(speedRatio)) speedRatio = 0;
  const t = ctx.currentTime;
  // 가짜 기어: 속도 구간마다 음이 다시 내려감
  const gears = 4, x = Math.min(0.999, Math.abs(speedRatio)) * gears;
  const inGear = x - Math.floor(x);
  const base = 45 + Math.floor(x) * 12 + inGear * 70 + throttle * 8;
  eng.o1.frequency.setTargetAtTime(base, t, 0.05);
  eng.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
  eng.f.frequency.setTargetAtTime(300 + throttle * 500 + x * 120, t, 0.08);
  eng.g.gain.setTargetAtTime(on ? 0.035 + throttle * 0.03 : 0, t, 0.1);
}

function tone(freq, dur, type, vol, when, slide) {
  if (!ctx) return;
  const t = ctx.currentTime + (when || 0);
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(vol || 0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, freq) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq || 800;
  g.gain.value = vol || 0.2;
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t);
}

export const sfx = {
  coin() { tone(988, 0.07, 'square', 0.1); tone(1319, 0.18, 'square', 0.1, 0.07); },
  gem() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, 'square', 0.1, i * 0.06)); },
  crash(v) { noise(0.25, Math.min(0.4, 0.08 + v * 0.015), 600); },
  land() { noise(0.12, 0.12, 300); },
  boost() { tone(220, 0.4, 'sawtooth', 0.08, 0, 880); },
  beep() { tone(660, 0.18, 'square', 0.14); },
  go() { tone(1320, 0.45, 'square', 0.14); },
  cp() { tone(880, 0.08, 'triangle', 0.14); tone(1175, 0.12, 'triangle', 0.14, 0.08); },
  lap() { [659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.12, i * 0.1)); },
  finish() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.12, i * 0.12)); },
  honk() { tone(392, 0.35, 'square', 0.09); tone(494, 0.35, 'square', 0.09); },
  buy() { [523, 784, 1047, 1568].forEach((f, i) => tone(f, 0.1, 'square', 0.1, i * 0.07)); },
  click() { tone(1200, 0.03, 'square', 0.06); },
  err() { tone(200, 0.2, 'square', 0.1); },
  item() { [660, 880, 1320].forEach((f, i) => tone(f, 0.07, 'square', 0.09, i * 0.05)); },
  shield() { tone(440, 0.3, 'triangle', 0.12, 0, 1320); },
  pop() { noise(0.15, 0.2, 2000); tone(1200, 0.1, 'square', 0.08); },
  splash() { noise(0.4, 0.25, 900); },
  warn() { [0, 0.25, 0.5].forEach(d => { tone(1500, 0.12, 'square', 0.1, d); tone(1100, 0.12, 'square', 0.1, d + 0.12); }); },
};
