// 헤드리스 플레이어 주행 시뮬 (game.js physics 핵심만 옮김) — 봇 속도를 사람 수준에 맞추는 기준값
// node tools/playersim.js [carId,...] [trackId,...]
const W = require('../public/world.js');
const GRAV = 30;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function lapTime(track, carId, opt = {}) {
  const t = W.trackById[track], d = W.carById[carId], n = t.path.length, L = t.length, step = L / n;
  // 출발: 출발선 20m 뒤에서 이미 달리는 중 (한 바퀴 랩타임)
  let i0 = (n - Math.round(30 / step)) % n;
  const p0 = t.path[i0], tg0 = t.tan[i0];
  const car = { x: p0[0], z: p0[1], y: t.ey[i0], yaw: Math.atan2(tg0[0], tg0[1]), vx: tg0[0] * d.maxV * 0.8, vz: tg0[1] * d.maxV * 0.8, steer: 0, boostT: 0, boostCd: 0, grounded: true, vy: 0 };
  const dt = 1 / 60;
  let time = 0, idx = i0, passed = false, travelled = 0, stuck = 0, crashes = 0;
  const R = curveR(t);
  for (let it = 0; it < 60 * 400; it++) {
    const fx0 = Math.sin(car.yaw), fz0 = Math.cos(car.yaw);
    // 경로 진행 (근처만 찾기)
    let bi = idx, bd = 1e9;
    for (let k = -3; k < 12; k++) { const j = (idx + k + n) % n, q = t.path[j], dd = (q[0] - car.x) ** 2 + (q[1] - car.z) ** 2 + ((t.ey[j] - car.y) * 3) ** 2; if (dd < bd) { bd = dd; bi = j; } }
    const adv = (bi - idx + n) % n; if (adv < n / 2) { travelled += adv; idx = bi; }
    if (travelled >= n - Math.round(30 / step) && !passed) { passed = true; time = 0; travelled = 0; }
    if (passed && travelled >= n) return { time, crashes };
    const sp = Math.hypot(car.vx, car.vz);
    // 앞쪽 커브를 보고 목표 속도
    let want = d.maxV * 2;
    for (let k = 1; k < 40; k++) {
      const j = (idx + k) % n, vc = cornerV(d, R[j]) * (opt.cornerK || 1);
      want = Math.min(want, Math.sqrt(vc * vc + 2 * 30 * k * step));
    }
    const look = Math.max(3, Math.round((6 + sp * 0.45) / step));
    const tp = t.path[(idx + look) % n];
    let diff = Math.atan2(tp[0] - car.x, tp[1] - car.z) - car.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const inp = { steer: clamp(diff * 2.5, -1, 1), up: sp < want, down: sp > want + 3, drift: false };
    step1(car, d, inp, dt, t);
    time += dt;
    if (sp < 2) { if (++stuck > 120) { crashes++; stuck = 0; const q = t.path[(idx + 2) % n], tg = t.tan[(idx + 2) % n]; Object.assign(car, { x: q[0], z: q[1], y: t.ey[(idx + 2) % n], yaw: Math.atan2(tg[0], tg[1]), vx: 0, vz: 0 }); } } else stuck = 0;
  }
  return { time: null, crashes };
}
// 플레이어 조향으로 낼 수 있는 커브 속도: v = R * turn * (1 - 0.42 v / maxV)
function cornerV(d, r) { const a = r * d.turn; return a / (1 + 0.42 * a / d.maxV); }
function curveR(t) {
  const n = t.path.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = t.tan[(i - 3 + n) % n], b = t.tan[(i + 3) % n], pa = t.path[(i - 3 + n) % n], pb = t.path[(i + 3) % n];
    const ang = Math.acos(clamp(a[0] * b[0] + a[1] * b[1], -1, 1));
    out[i] = Math.min(2000, Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / Math.max(ang, 1e-4));
  }
  return out;
}
function step1(car, d, inp, dt) {
  car.steer += (inp.steer - car.steer) * Math.min(1, dt * 7);
  car.boostT = Math.max(0, car.boostT - dt); car.boostCd = Math.max(0, car.boostCd - dt);
  let fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), lx = fz, lz = -fx;
  let vf = car.vx * fx + car.vz * fz, vl = car.vx * lx + car.vz * lz;
  const surf = W.surfaceAt(car.x, car.z, car.y + 0.5);
  const offPen = !d.off && surf === 'grass' ? 0.55 : (!d.off && surf === 'dirt' ? 0.85 : (surf === 'walk' ? 0.9 : (surf === 'runoff' ? (d.off ? 0.85 : 0.65) : (surf === 'water' ? 0.3 : (surf === 'mud' ? 0.5 : 1)))));
  const maxV = d.maxV * offPen;
  if (car.grounded) {
    if (inp.up) { const r = Math.max(0, 1 - (vf / maxV) ** 2); vf += d.acc * r * dt; }
    else if (inp.down) { if (vf > 0.5) vf -= 32 * dt; }
    else vf -= Math.sign(vf) * Math.min(Math.abs(vf), (1.8 + Math.abs(vf) * 0.06) * dt);
    if (vf > maxV && car.boostT <= 0) vf -= (vf - maxV) * (offPen < 1 ? 2.2 : 0.9) * dt;
    if (surf === 'mud' && vf > maxV) vf -= (vf - maxV) * Math.min(1, 6 * dt);
    const bp = W.boostAt(car.x, car.z, car.y);
    if (bp && car.boostCd <= 0 && car.vx * bp.fx + car.vz * bp.fz > 0) { vf = Math.max(vf, d.maxV * 1.35); car.boostT = 1.4; car.boostCd = 0.6; }
  }
  car.vx = fx * vf + lx * vl; car.vz = fz * vf + lz * vl;
  const sp = Math.abs(vf);
  if (car.grounded) car.yaw += car.steer * d.turn * Math.min(1, sp / 5) * (1 - 0.42 * Math.min(1, sp / d.maxV)) * dt;
  fx = Math.sin(car.yaw); fz = Math.cos(car.yaw); lx = fz; lz = -fx;
  vf = car.vx * fx + car.vz * fz; vl = car.vx * lx + car.vz * lz;
  if (car.grounded) {
    const grip = (offPen < 0.7 ? d.grip * 0.65 : d.grip) * (surf === 'ice' ? 0.42 : 1);
    const nvl = vl * Math.exp(-grip * dt), lost = Math.abs(vl - nvl);
    if (vf > 1 && vf < maxV) vf = Math.min(maxV, vf + lost * 0.3);
    vl = nvl;
    car.vx = fx * vf + lx * vl; car.vz = fz * vf + lz * vl;
  }
  let nx = car.x + car.vx * dt, nz = car.z + car.vz * dt;
  if (W.groundHeight(nx, nz, car.y + 0.5) - car.y > 0.9) { nx = car.x; nz = car.z; car.vx *= -0.25; car.vz *= -0.25; }
  car.x = nx; car.z = nz;
  for (const oz of [-1.2, 1.2]) {
    const ox = Math.sin(car.yaw) * oz, oy = Math.cos(car.yaw) * oz;
    const pos = { x: car.x + ox, z: car.z + oy }, vel = { x: car.vx, z: car.vz };
    W.collide(pos, 1, vel, car.y);
    car.x = pos.x - ox; car.z = pos.z - oy; car.vx = vel.x; car.vz = vel.z;
  }
  const gh = W.groundHeight(car.x, car.z, car.y + 0.5);
  if (car.grounded) { if (gh >= car.y - 0.32) { car.y = gh; } else { car.grounded = false; car.vy = 0; } }
  if (!car.grounded) { car.vy -= GRAV * dt; car.y += car.vy * dt; if (car.y <= gh) { car.y = gh; car.vy = 0; car.grounded = true; } }
  if (car.y < -40) { car.y = 0; }
}
module.exports = { lapTime, cornerV, curveR };
if (require.main === module) {
  const cars = (process.argv[2] || 'hatch,avante,gtr').split(',');
  const tracks = process.argv[3] ? process.argv[3].split(',') : W.arenas.map(a => a.id);
  for (const tr of tracks) {
    const row = [tr.padEnd(12), String(W.trackById[tr].diff), String(Math.round(W.trackById[tr].length)).padStart(5)];
    for (const c of cars) { const r = lapTime(tr, c); row.push((r.time ? r.time.toFixed(1) : 'X') + (r.crashes ? '!' + r.crashes : '')); }
    console.log(row.join('  '));
  }
}
