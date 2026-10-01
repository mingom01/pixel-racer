// 픽셀 레이서 — 메인 (렌더링 / 물리 / 네트워크 / UI)
import * as THREE from './lib/three.module.min.js';
import { makeTextures } from './tex.js';
import { buildWorld, makeCar, makeNameTag, makeGate, makeCoinAssets, carShape } from './models.js';
import { initAudio, engine, sfx, setVolume } from './audio.js';
import { makeLocalServer } from './local.js';
import { GP, initGP, enterGP, leaveGP, gpMsg, gpFrame, prePhysics, respawnGP, useItem, swapItem, camTarget, nextSpectate, drawMap as gpDrawMap, toggleLobby } from './gp.js';

const W = window.WORLD;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const angLerp = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const colorCss = i => '#' + (W.COLORS[i] ?? 0xffffff).toString(16).padStart(6, '0');
const fmtTime = ms => { if (ms == null) return '-'; const s = ms / 1000, m = Math.floor(s / 60); return m + ':' + (s % 60).toFixed(2).padStart(5, '0'); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
const COARSE = matchMedia('(pointer: coarse)').matches;
const settings = Object.assign({ pix: COARSE ? 1 : 2, shadow: 1, vol: 60, cam: 0, steer: 'pad', autoGas: 0 }, (() => { try { return JSON.parse(lsGet('pr_settings') || '{}'); } catch (e) { return {}; } })());
const saveSettings = () => lsSet('pr_settings', JSON.stringify(settings));

/* ================= 렌더러 ================= */
const canvas = $('c3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = !!settings.shadow;
renderer.shadowMap.type = THREE.BasicShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x86b8ec);
scene.fog = new THREE.Fog(0x9cc4ec, 200, 700);
const camera = new THREE.PerspectiveCamera(65, 1, 0.3, 2000);
const hemi = new THREE.HemisphereLight(0xdfefff, 0x5a7040, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 1.9);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0015;
scene.add(sun, sun.target);

function resize() {
  const s = settings.pix, w = innerWidth, h = innerHeight;
  renderer.setSize(Math.max(1, Math.floor(w / s)), Math.max(1, Math.floor(h / s)), false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

try { await Promise.race([document.fonts.load('12px Galmuri11'), new Promise(r => setTimeout(r, 2500))]); } catch (e) { /* ignore */ }
const T = makeTextures();
document.documentElement.style.setProperty('--coin-img', `url(${T.coin.image.toDataURL()})`);
const worldRoot = buildWorld(scene, T);
const coinGroup = new THREE.Group();
scene.add(coinGroup);

/* ---------- 코인 ---------- */
const coinAssets = makeCoinAssets(T);
const coinMeshes = W.coins.map(c => {
  const a = c.big ? coinAssets.big : coinAssets.small;
  const m = new THREE.Mesh(a.geo, a.mat);
  m.position.set(c.x, c.y, c.z);
  m.castShadow = true;
  coinGroup.add(m);
  return m;
});
const coinUp = new Array(W.coins.length).fill(true);
function setCoin(id, up) { coinUp[id] = up; coinMeshes[id].visible = up; }

/* ---------- 체크포인트 게이트 ---------- */
const gate = makeGate();
gate.visible = false;
scene.add(gate);

/* ---------- 스키드 마크 ---------- */
const SKID_N = 900;
const skidGeo = new THREE.PlaneGeometry(0.42, 1.0);
skidGeo.rotateX(-Math.PI / 2);
const skids = new THREE.InstancedMesh(skidGeo, new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), SKID_N);
skids.frustumCulled = false;
const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < SKID_N; i++) skids.setMatrixAt(i, zeroM);
scene.add(skids);
let skidIdx = 0;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _yAxis = new THREE.Vector3(0, 1, 0);
function addSkid(x, y, z, yaw) {
  _q.setFromAxisAngle(_yAxis, yaw);
  _v.set(x, y + 0.13, z);
  _m.compose(_v, _q, _s);
  skids.setMatrixAt(skidIdx, _m);
  skidIdx = (skidIdx + 1) % SKID_N;
  skids.instanceMatrix.needsUpdate = true;
}

/* ---------- 파티클 (복셀 조각) ---------- */
const PART_N = 260;
const parts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: 0xffffff }), PART_N);
parts.frustumCulled = false;
const pList = [];
for (let i = 0; i < PART_N; i++) { parts.setMatrixAt(i, zeroM); parts.setColorAt(i, new THREE.Color(1, 1, 1)); }
scene.add(parts);
let partIdx = 0;
const _c = new THREE.Color();
function spawnPart(x, y, z, vx, vy, vz, color, life, size) {
  const i = partIdx; partIdx = (partIdx + 1) % PART_N;
  pList[i] = { x, y, z, vx, vy, vz, life, max: life, size: size || 1 };
  parts.setColorAt(i, _c.setHex(color));
  parts.instanceColor.needsUpdate = true;
}
function updateParts(dt) {
  for (let i = 0; i < PART_N; i++) {
    const p = pList[i];
    if (!p) continue;
    p.life -= dt;
    if (p.life <= 0) { pList[i] = null; parts.setMatrixAt(i, zeroM); continue; }
    p.vy -= 6 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const s = p.size * (p.life / p.max);
    _v.set(p.x, p.y, p.z); _s.set(s, s, s); _q.identity();
    _m.compose(_v, _q, _s);
    parts.setMatrixAt(i, _m);
  }
  _s.set(1, 1, 1);
  parts.instanceMatrix.needsUpdate = true;
}

/* ================= 게임 상태 ================= */
const G = {
  screen: 'loading', cfg: {}, ws: null, session: lsGet('pr_session'), me: null,
  room: null, myId: null, hostId: null, players: new Map(), race: null,
  touch: false, rotHint: false, wantRejoin: null, chatOpen: false, menuOpen: false, garageOpen: false, bigmap: false,
  lastSend: 0, time: 0,
};

const car = {
  x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, vy: 0, grounded: true, steer: 0, pitch: 0, roll: 0,
  vf: 0, vl: 0, boostT: 0, boostCd: 0, drifting: false, model: null, def: W.CARS[0], hitCd: 0, respawnCd: 0, airT: 0,
  yawRate: 0, bumpT: 0, driftT: 0, exitT: 0, shape: null,
};
function spawnCar(x, z, yaw) {
  Object.assign(car, { x, z, y: W.groundHeight(x, z), yaw, vx: 0, vz: 0, vy: 0, grounded: true, steer: 0, vf: 0, vl: 0, boostT: 0, pitch: 0, roll: 0, yawRate: 0, bumpT: 0, driftT: 0 });
  camState.yaw = yaw; camState.init = false;
}
function rebuildMyCar() {
  if (car.model) scene.remove(car.model.root);
  car.def = W.carById[G.me.car] || W.CARS[0];
  car.model = makeCar(car.def.id, G.me.color);
  car.shape = carShape(car.def.id);
  scene.add(car.model.root);
  $('carName').textContent = car.def.name;
}

/* ================= 입력 ================= */
const keys = {};
const touch = { left: false, right: false, gas: false, brake: false, drift: false, steer: 0 };
function typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA'); }
// 키보드 단축키와 휴대폰 버튼이 같이 쓰는 동작
function doAction(a) {
  initAudio();
  if (a === 'respawn') respawn();
  else if (a === 'cam') { settings.cam = (settings.cam + 1) % 3; saveSettings(); toast(['뒤 카메라', '멀리서 보기', '보닛 카메라'][settings.cam]); }
  else if (a === 'honk') { sfx.honk(); send({ t: 'honk' }); }
  else if (a === 'map') { G.bigmap = !G.bigmap; $('bigmap').classList.toggle('hidden', !G.bigmap); }
  else if (a === 'chat') { if (G.chatOpen) closeChat(); else openChat(); }
  else if (a === 'full') toggleFullscreen();
}
addEventListener('keydown', e => {
  initAudio();
  if (G.screen === 'play') {
    if (e.key === 'Enter') {
      if (G.chatOpen) { sendChat(); e.preventDefault(); return; }
      if (!typing() && !G.menuOpen && !G.garageOpen) { openChat(); e.preventDefault(); return; }
    }
    if (e.code === 'Escape') {
      if (G.chatOpen) { closeChat(); return; }
      if (G.garageOpen) { closeGarage(); return; }
      if (!$('results').classList.contains('hidden')) { $('results').classList.add('hidden'); return; }
      toggleMenu(); return;
    }
    if (typing()) return;
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (GP.active) {
      if (e.code === 'KeyE' || e.key === 'Shift') { useItem(); return; }
      if (e.code === 'KeyQ') { swapItem(); return; }
      if (e.code === 'Space' && GP.spectating()) { nextSpectate(); return; }
    }
    const act = { KeyR: 'respawn', KeyC: 'cam', KeyH: 'honk', KeyM: 'map' }[e.code];
    if (act) doAction(act);
  } else if (e.code === 'Escape' && G.garageOpen) closeGarage();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('pointerdown', () => initAudio());
function readInput() {
  if (G.chatOpen || G.menuOpen || G.garageOpen) return { up: false, down: false, steer: 0, drift: false };
  const k = keys;
  const left = k.KeyA || k.ArrowLeft || touch.left, right = k.KeyD || k.ArrowRight || touch.right;
  const kb = (left ? 1 : 0) - (right ? 1 : 0);
  const down = !!(k.KeyS || k.ArrowDown || touch.brake);
  const auto = G.touch && settings.autoGas && !down;
  return {
    up: !!(k.KeyW || k.ArrowUp || touch.gas || auto), down,
    steer: kb !== 0 ? kb : (Number.isFinite(touch.steer) ? touch.steer : 0), drift: !!(k.Space || touch.drift),
  };
}

/* ---------- 휴대폰 조작 ---------- */
function setTouch(on) {
  G.touch = on;
  document.body.classList.toggle('touch', on);
  $('touch').classList.toggle('hidden', !(on && G.screen === 'play'));
  if (G.screen === 'play') renderPlayerList();
}
addEventListener('touchstart', () => { if (!G.touch) setTouch(true); }, { passive: true });
function capture(el, id) { try { el.setPointerCapture(id); } catch (e) { /* 이미 끝난 포인터 */ } }
// 페달 / 버튼 핸들: 손가락마다 따로 (멀티터치)
document.querySelectorAll('#touch .tb').forEach(b => {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); capture(b, e.pointerId); touch[k] = true; b.classList.add('on'); initAudio(); };
  const off = e => { e.preventDefault(); touch[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
});
// 드래그 핸들: 처음 누른 곳 기준으로 좌우로 끈 만큼 아날로그 조향
{
  const pad = $('steerpad'), knob = pad.querySelector('.knob');
  let pid = null, ox = 0;
  const range = () => Math.max(30, pad.clientWidth * 0.32);
  const move = e => {
    const dx = clamp(e.clientX - ox, -range(), range());
    let v = -dx / range();
    if (Math.abs(v) < 0.08) v = 0;
    touch.steer = clamp(v * 1.1, -1, 1);
    knob.style.left = `calc(50% + ${dx}px)`;
  };
  pad.addEventListener('pointerdown', e => {
    e.preventDefault(); initAudio();
    pid = e.pointerId; capture(pad, pid);
    ox = e.clientX; pad.classList.add('on');
    move(e);
  });
  pad.addEventListener('pointermove', e => { if (e.pointerId === pid) move(e); });
  const end = e => {
    if (e.pointerId !== pid) return;
    pid = null; touch.steer = 0; pad.classList.remove('on'); knob.style.left = '50%';
  };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
}
document.querySelectorAll('#actions .ab').forEach(b => b.addEventListener('click', e => { e.preventDefault(); doAction(b.dataset.a); b.blur(); }));
function applyTouchSettings() {
  $('steerpad').classList.toggle('hidden', settings.steer === 'btn');
  $('steerbtns').classList.toggle('hidden', settings.steer !== 'btn');
  const gas = document.querySelector('#pedals [data-k=gas]');
  gas.classList.toggle('auto', !!settings.autoGas);
  gas.textContent = settings.autoGas ? '자동' : 'GO';
}
const fsEl = document.documentElement;
if (!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen)) $('fullBtn').remove();
function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl, { navigationUI: 'hide' })?.catch?.(() => {});
}
// 게임 중 화면 꺼짐 방지
let wakeLock = null;
async function keepAwake() {
  if (!G.touch || G.screen !== 'play' || wakeLock || !navigator.wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (e) { /* ignore */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

/* ================= 물리 ================= */
// 차의 회전된 사각형 (x,z 는 모델 원점, shape.cz 만큼 중심 보정)
function obb(x, z, yaw, sh) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  return { x: x + fx * sh.cz, z: z + fz * sh.cz, fx, fz, lx: fz, lz: -fx, hw: sh.hw, hl: sh.hl };
}
function obbCorners(b) {
  const out = [];
  for (const [s, t] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.push([b.x + b.fx * b.hl * s + b.lx * b.hw * t, b.z + b.fz * b.hl * s + b.lz * b.hw * t]);
  return out;
}
function inObb(b, px, pz) {
  const dx = px - b.x, dz = pz - b.z;
  return Math.abs(dx * b.fx + dz * b.fz) <= b.hl && Math.abs(dx * b.lx + dz * b.lz) <= b.hw;
}
// A 와 B 가 겹치면 { nx,nz (B→A), pen, cx,cz (접촉점) }
function obbHit(A, B) {
  const dx = A.x - B.x, dz = A.z - B.z;
  let best = null;
  for (const [ux, uz] of [[A.fx, A.fz], [A.lx, A.lz], [B.fx, B.fz], [B.lx, B.lz]]) {
    const ra = A.hl * Math.abs(A.fx * ux + A.fz * uz) + A.hw * Math.abs(A.lx * ux + A.lz * uz);
    const rb = B.hl * Math.abs(B.fx * ux + B.fz * uz) + B.hw * Math.abs(B.lx * ux + B.lz * uz);
    const dd = dx * ux + dz * uz, ov = ra + rb - Math.abs(dd);
    if (ov <= 0) return null;
    if (!best || ov < best.pen) best = { pen: ov, nx: dd >= 0 ? ux : -ux, nz: dd >= 0 ? uz : -uz };
  }
  let cx = 0, cz = 0, n = 0;
  for (const [px, pz] of obbCorners(A)) if (inObb(B, px, pz)) { cx += px; cz += pz; n++; }
  for (const [px, pz] of obbCorners(B)) if (inObb(A, px, pz)) { cx += px; cz += pz; n++; }
  if (n) { best.cx = cx / n; best.cz = cz / n; } else { best.cx = (A.x + B.x) / 2; best.cz = (A.z + B.z) / 2; }
  return best;
}
const GRAV = 24;
function physics(dt) {
  const d = car.def;
  const now = performance.now();
  const frozen = (G.race && G.race.inRace && now < G.race.startAt) || GP.frozen();
  let inp = frozen ? { up: false, down: false, steer: readInput().steer, drift: false } : readInput();
  inp = prePhysics(dt, inp);
  car.steer += (inp.steer - car.steer) * Math.min(1, dt * 7);
  car.boostT = Math.max(0, car.boostT - dt);
  car.boostCd = Math.max(0, car.boostCd - dt);
  car.hitCd = Math.max(0, car.hitCd - dt);
  car.respawnCd = Math.max(0, car.respawnCd - dt);

  let fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), lx = fz, lz = -fx;
  let vf = car.vx * fx + car.vz * fz, vl = car.vx * lx + car.vz * lz;
  const surf = W.surfaceAt(car.x, car.z);
  car.surf = surf;
  const offPen = !d.off && surf === 'grass' ? 0.55 : (!d.off && surf === 'dirt' ? 0.85 : (surf === 'walk' ? 0.9 : (surf === 'runoff' ? (d.off ? 0.85 : 0.65) : 1)));
  const maxV = d.maxV * offPen;

  if (car.grounded) {
    if (frozen) vf *= Math.exp(-6 * dt);
    else if (inp.up && !inp.down) {
      if (vf < -0.5) vf += 30 * dt;
      else { const r = Math.max(0, 1 - (vf / maxV) ** 2); vf += d.acc * r * dt * (inp.drift ? 0.9 : 1); }
    } else if (inp.down && !inp.up) {
      if (vf > 0.5) vf -= 32 * dt;
      else vf = Math.max(-maxV * 0.35, vf - d.acc * 0.6 * dt);
    } else {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), (1.8 + Math.abs(vf) * 0.06) * dt);
    }
    if (vf > maxV && car.boostT <= 0) vf -= (vf - maxV) * (offPen < 1 ? 2.2 : 0.9) * dt;
    const bp = W.boostAt(car.x, car.z);
    if (bp && !frozen && car.boostCd <= 0) {
      const along = car.vx * bp.fx + car.vz * bp.fz;
      if (along > 0) { vf = Math.max(vf, d.maxV * 1.35); car.boostT = 1.4; car.boostCd = 0.6; sfx.boost(); }
    }
  }
  // 엔진 적용 (현재 방향 기준으로 재합성)
  car.vx = fx * vf + lx * vl; car.vz = fz * vf + lz * vl;

  // 조향
  const sp = Math.abs(vf);
  if (car.grounded) {
    const turnF = Math.min(1, sp / 5) * (1 - 0.42 * Math.min(1, sp / d.maxV));
    car.yaw += car.steer * d.turn * turnF * (vf >= 0 ? 1 : -1) * (inp.drift ? 1.35 : 1) * dt;
  } else {
    car.yaw += car.steer * 1.2 * dt;
  }
  // 충돌로 생긴 회전
  car.yaw += car.yawRate * dt;
  car.yawRate *= Math.exp(-(car.grounded ? 3 : 0.6) * dt);
  car.bumpT = Math.max(0, car.bumpT - dt);
  car.exitT = Math.max(0, car.exitT - dt);
  fx = Math.sin(car.yaw); fz = Math.cos(car.yaw); lx = fz; lz = -fx;
  vf = car.vx * fx + car.vz * fz; vl = car.vx * lx + car.vz * lz;
  if (car.grounded) {
    if (inp.drift && vf > 5) {
      // 드리프트: 속도 크기는 거의 유지하고, 미끄러지는 각도만 천천히 줄이고 최대 43도로 제한
      const spd = Math.hypot(vf, vl);
      const slip = clamp(Math.atan2(vl, vf) * Math.exp(-2 * dt), -0.75, 0.75);
      const ns = spd * (1 - 0.12 * dt);
      vf = ns * Math.cos(slip); vl = ns * Math.sin(slip);
    } else {
      const grip = (offPen < 0.7 ? d.grip * 0.65 : d.grip) * (car.bumpT > 0 ? 0.3 : 1) * (surf === 'ice' ? 0.42 : 1);
      const nvl = vl * Math.exp(-grip * dt);
      // 옆으로 미끄러지며 잃는 속도의 일부를 앞으로 돌려줌 (드리프트 직후엔 더 많이)
      const lost = Math.abs(vl - nvl);
      if (vf > 1 && vf < maxV) vf = Math.min(maxV, vf + lost * (car.exitT > 0 ? 0.85 : 0.3));
      vl = nvl;
    }
    car.vx = fx * vf + lx * vl; car.vz = fz * vf + lz * vl;
  }
  car.vf = vf; car.vl = vl;
  car.drifting = car.grounded && Math.abs(vl) > 6 && sp > 8;
  // 드리프트를 길게 하고 풀면 미니 부스트
  if (car.drifting && inp.drift) car.driftT += dt;
  else if (!inp.drift) {
    if (car.driftT > 0) car.exitT = 0.5;
    if (car.driftT > 0.9 && car.grounded && vf > 5) {
      const add = Math.min(9, 3 + car.driftT * 2.5);
      const nv = Math.min(vf + add, Math.max(vf, d.maxV * 1.15));
      car.vx += fx * (nv - vf); car.vz += fz * (nv - vf);
      car.boostT = Math.max(car.boostT, 0.6); sfx.boost();
    }
    car.driftT = 0;
  }

  // 이동 + 벽(경사로 옆면) 판정
  let nx = car.x + car.vx * dt, nz = car.z + car.vz * dt;
  const ghN = W.groundHeight(nx, nz);
  let hit = 0;
  if (ghN - car.y > 0.9) {
    hit = Math.hypot(car.vx, car.vz);
    nx = car.x; nz = car.z;
    car.vx *= -0.25; car.vz *= -0.25;
  }
  car.x = nx; car.z = nz;
  const sh = car.shape;
  for (const oz of sh.offs) {
    const ox = Math.sin(car.yaw) * oz, oy = Math.cos(car.yaw) * oz;
    const pos = { x: car.x + ox, z: car.z + oy }, vel = { x: car.vx, z: car.vz };
    hit = Math.max(hit, W.collide(pos, sh.r, vel));
    car.x = pos.x - ox; car.z = pos.z - oy; car.vx = vel.x; car.vz = vel.z;
  }

  // 다른 차와 충돌 (범퍼카): 회전된 사각형끼리 SAT 로 충돌면/접촉점을 구함
  const myBox = obb(car.x, car.z, car.yaw, sh);
  for (const p of G.players.values()) {
    if (!p.disp || !p.shape || p.disp.hidden || GP.ghost() || GP.spectating() || Math.abs(car.y - p.disp.y) > 2.5) continue;
    const ddx = car.x - p.disp.x, ddz = car.z - p.disp.z;
    if (ddx * ddx + ddz * ddz > 400) continue;
    const best = obbHit(myBox, obb(p.disp.x, p.disp.z, p.disp.yaw, p.shape));
    if (!best) continue;
    const { nx, nz } = best;
    car.x += nx * best.pen; car.z += nz * best.pen;
    myBox.x += nx * best.pen; myBox.z += nz * best.pen;
    const pvx = p.disp.vx, pvz = p.disp.vz;
    const rv = (car.vx - pvx) * nx + (car.vz - pvz) * nz;
    if (rv > -0.8) continue;
    const mA = d.mass || 1.2, mB = W.carById[p.car]?.mass || 1.2;
    // 누가 들이받았는지: 상대 쪽으로 더 빨리 달려든 쪽이 가해자 → 상대에게 밀림을 보냄
    const sA = -(car.vx * nx + car.vz * nz), sB = pvx * nx + pvz * nz;
    const striker = sA > sB + 1.5, victim = sB > sA + 1.5;
    if (now - (p.lastBump || 0) < 250) {
      // 붙어 있는 동안은 파고들지 않게만
      if (!victim) { car.vx -= rv * nx; car.vz -= rv * nz; }
      continue;
    }
    p.lastBump = now;
    const j = -(1 + 0.45) * rv / (1 / mA + 1 / mB);
    if (!victim) {
      car.vx += j / mA * nx; car.vz += j / mA * nz;
      const rx = best.cx - car.x, rz = best.cz - car.z;
      car.yawRate += clamp((rz * nx - rx * nz) * j / (mA * 3), -2.5, 2.5);
      car.bumpT = 0.3;
    }
    if (striker) {
      let dvx = -j / mB * nx, dvz = -j / mB * nz;
      const mag = Math.hypot(dvx, dvz) || 1, want = Math.max(mag * 1.25, 6);
      dvx *= want / mag; dvz *= want / mag;
      const rx = best.cx - p.disp.x, rz = best.cz - p.disp.z;
      const w = clamp((rz * dvx - rx * dvz) / 2.5, -3.5, 3.5);
      send({ t: 'bump', to: p.id, dv: [Math.round(dvx * 100) / 100, Math.round(dvz * 100) / 100], w: Math.round(w * 100) / 100 });
    }
    hit = Math.max(hit, -rv);
    for (let i = 0; i < 8; i++) spawnPart(best.cx, car.y + 0.8, best.cz, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, i % 2 ? 0xffd040 : 0xffffff, 0.4, 0.7);
  }
  if (hit > 6 && car.hitCd <= 0) {
    sfx.crash(hit); car.hitCd = 0.3; camState.shake = Math.min(0.6, hit * 0.02);
    for (let i = 0; i < 6; i++) spawnPart(car.x, car.y + 1, car.z, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 0xdddddd, 0.6);
  }

  // 수직
  const gh = W.groundHeight(car.x, car.z);
  if (car.grounded) {
    if (gh >= car.y - 0.32) { car.vy = (gh - car.y) / dt; car.y = gh; }
    else { car.grounded = false; car.airT = 0; car.vy = Math.min(car.vy, 30); }
  }
  if (!car.grounded) {
    car.airT += dt;
    car.vy -= GRAV * (car.def.id === 'buggy' ? 0.85 : 1) * dt;
    car.y += car.vy * dt;
    if (car.y <= gh) {
      if (car.vy < -9) { sfx.land(); camState.shake = Math.min(0.5, -car.vy * 0.02); for (let i = 0; i < 8; i++) spawnPart(car.x, gh + 0.3, car.z, (Math.random() - 0.5) * 8, Math.random() * 3, (Math.random() - 0.5) * 8, 0xb0a080, 0.5); }
      car.y = gh; car.vy = 0; car.grounded = true;
    }
  }

  // 차체 기울기
  if (car.grounded) {
    const hf = W.groundHeight(car.x + fx * 1.6, car.z + fz * 1.6), hb = W.groundHeight(car.x - fx * 1.6, car.z - fz * 1.6);
    const hl = W.groundHeight(car.x + lx * 0.9, car.z + lz * 0.9), hr = W.groundHeight(car.x - lx * 0.9, car.z - lz * 0.9);
    const tp = Math.atan2(hf - hb, 3.2) + clamp(-(inp.up ? 0.02 : 0) + (inp.down && vf > 1 ? -0.03 : 0), -0.05, 0.05);
    const tr = Math.atan2(hl - hr, 1.8) + clamp(vl * 0.012 - car.steer * sp * 0.0012, -0.12, 0.12);
    car.pitch = lerp(car.pitch, tp, Math.min(1, dt * 12));
    car.roll = lerp(car.roll, tr, Math.min(1, dt * 10));
  } else {
    car.pitch = lerp(car.pitch, clamp(car.vy * 0.025, -0.5, 0.35), Math.min(1, dt * 2));
    car.roll = lerp(car.roll, 0, Math.min(1, dt * 3));
  }
  car.frozen = frozen;
  car.input = inp;
  // 혹시 값이 깨지면 (NaN) 가까운 도로로 되돌림
  if (!Number.isFinite(car.x + car.y + car.z + car.vx + car.vz + car.yaw)) {
    const p = W.respawnPoint(Number.isFinite(car.x) ? car.x : -60, Number.isFinite(car.z) ? car.z : 0);
    spawnCar(p.x, p.z, p.yaw);
  }
}

function respawn() {
  if (GP.active) { if (car.respawnCd <= 0) { car.respawnCd = 1; respawnGP(); } return; }
  if (car.respawnCd > 0) return;
  car.respawnCd = 1;
  const r = G.race;
  if (r && r.inRace && !r.done && performance.now() >= r.startAt) {
    const t = W.trackById[r.track], n = t.cps.length;
    let idx;
    if (r.c === 0) { const s = W.gridSlot(t, r.slot); spawnCar(s.x, s.z, s.yaw); return; }
    idx = t.cps[(r.c - 1) % n];
    const p = t.path[idx], tg = t.tan[idx];
    spawnCar(p[0], p[1], Math.atan2(tg[0], tg[1]));
    return;
  }
  const p = W.respawnPoint(car.x, car.z);
  // 원래 보던 방향과 가까운 쪽을 향하게
  let yaw = p.yaw;
  if (Math.cos(yaw - car.yaw) < 0) yaw += Math.PI;
  spawnCar(p.x, p.z, yaw);
}

/* ================= 차 그리기 ================= */
function poseModel(m, s, dt) {
  m.root.position.set(s.x, s.y, s.z);
  m.root.rotation.set(-s.pitch, s.yaw, s.roll, 'YXZ');
  for (const w of m.wheels) {
    if (w.front) w.piv.rotation.y = s.steer * 0.45;
    w.spin.rotation.x += (s.v / w.r) * dt;
  }
}
function carFx(s, isMe, dt) {
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), lx = fz, lz = -fx;
  const gh = W.groundHeight(s.x, s.z);
  const onGround = s.y - gh < 0.3;
  if (!onGround) return;
  const rearZ = -1.3;
  const surf = isMe ? car.surf : null;
  if (s.drift) {
    for (const side of [-1, 1]) addSkid(s.x + fx * rearZ + lx * side * 0.95, gh, s.z + fz * rearZ + lz * side * 0.95, s.yaw);
    if (Math.random() < 0.3) spawnPart(s.x + fx * rearZ + lx * (Math.random() - 0.5) * 2, gh + 0.3, s.z + fz * rearZ + lz * (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2, 0xb4b4b4, 0.5, 1.1);
  }
  if (isMe && Math.abs(s.v) > 10 && (surf === 'grass' || surf === 'dirt') && Math.random() < 0.4) {
    spawnPart(s.x + fx * rearZ, gh + 0.3, s.z + fz * rearZ, -fx * 2 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, -fz * 2 + (Math.random() - 0.5) * 3, surf === 'grass' ? 0x5a9a34 : 0x9a7a50, 0.5, 0.8);
  }
  if (isMe && car.driftT > 0.9 && Math.random() < 0.7) {
    const side = Math.random() < 0.5 ? -1 : 1, hot = car.driftT > 2 ? 0x60c0ff : 0xffa020;
    spawnPart(s.x + fx * rearZ + lx * side * 0.95, gh + 0.25, s.z + fz * rearZ + lz * side * 0.95, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, hot, 0.3, 0.6);
  }
  if (s.boost && Math.random() < 0.8) {
    spawnPart(s.x - fx * 2.4, s.y + 0.6, s.z - fz * 2.4, -fx * 6, 0.5, -fz * 6, Math.random() < 0.5 ? 0xffb030 : 0xff5020, 0.3, 1.3);
  }
  void dt;
}

/* ================= 카메라 ================= */
const camState = { yaw: 0, y: 0, shake: 0, init: false, fov: 65 };
function updateCamera(dt) {
  if (G.screen !== 'play') {
    const t = performance.now() / 1000 * 0.05;
    camera.position.set(Math.sin(t) * 380, 120, Math.cos(t) * 380);
    camera.lookAt(0, 0, 0);
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    sun.position.set(60, 150, 40); sun.target.position.set(0, 0, 0);
    return;
  }
  const C = camTarget() || car;
  const sp = Math.hypot(C.vx, C.vz);
  let targetYaw = C.yaw;
  if (C.vf < -3) targetYaw = C.yaw; // 후진 중에도 뒤에서
  if (!camState.init) { camState.yaw = C.yaw; camState.y = C.y; camState.init = true; }
  camState.yaw = angLerp(camState.yaw, targetYaw, Math.min(1, dt * (3 + sp * 0.05)));
  camState.y = lerp(camState.y, C.y, Math.min(1, dt * (C.grounded ? 8 : 3)));
  const fx = Math.sin(camState.yaw), fz = Math.cos(camState.yaw);
  const mode = settings.cam;
  let px, py, pz, lx, ly, lz;
  if (mode === 2) {
    const cf = Math.sin(C.yaw), cz = Math.cos(C.yaw);
    px = C.x + cf * C.shape.len * 0.2; py = C.y + C.shape.top + 0.1; pz = C.z + cz * C.shape.len * 0.2;
    lx = C.x + cf * 30; ly = C.y + 1.2 - C.pitch * 20; lz = C.z + cz * 30;
  } else {
    const big = Math.max(0, C.shape.len - 4.6), tall = Math.max(0, C.shape.top - 1.6);
    const dist = (mode === 0 ? 8.5 + sp * 0.03 : 15) + big * 0.9, h = (mode === 0 ? 3.4 : 6.5) + tall * 0.8 + big * 0.15;
    px = C.x - fx * dist; py = camState.y + h; pz = C.z - fz * dist;
    lx = C.x + fx * 4; ly = camState.y + 1.3; lz = C.z + fz * 4;
  }
  py = Math.max(py, W.groundHeight(px, pz) + 0.8);
  if (camState.shake > 0) {
    const s = camState.shake;
    px += (Math.random() - 0.5) * s; py += (Math.random() - 0.5) * s; pz += (Math.random() - 0.5) * s;
    camState.shake = Math.max(0, s - dt * 1.5);
  }
  camera.position.set(px, py, pz);
  camera.lookAt(lx, ly, lz);
  const fov = 62 + Math.min(1, sp / 60) * 14 + (C.boostT > 0 ? 8 : 0);
  camState.fov = lerp(camState.fov, fov, Math.min(1, dt * 4));
  camera.fov = camState.fov; camera.updateProjectionMatrix();
  sun.position.set(C.x + 60, C.y + 150, C.z + 40);
  sun.target.position.set(C.x, C.y, C.z);
}

/* ================= 원격 플레이어 ================= */
function addPlayer(info) {
  let p = G.players.get(info.id);
  if (!p) { p = { id: info.id, snaps: [], disp: null, prog: 0 }; G.players.set(info.id, p); }
  Object.assign(p, { name: info.name, car: info.car, color: info.color });
  if (p.model) scene.remove(p.model.root);
  p.model = makeCar(p.car, p.color);
  p.shape = carShape(p.car);
  p.model.root.visible = false;
  const tag = makeNameTag(p.name, colorCss(p.color));
  tag.position.set(0, p.shape.top + 1.3, 0);
  p.model.root.add(tag);
  scene.add(p.model.root);
  renderPlayerList();
}
function removePlayer(id) {
  const p = G.players.get(id);
  if (!p) return;
  if (p.model) scene.remove(p.model.root);
  G.players.delete(id);
  renderPlayerList();
}
function clearPlayers() { for (const id of [...G.players.keys()]) removePlayer(id); }

function updateRemotes(now, dt) {
  const rt = now - 120;
  for (const p of G.players.values()) {
    const s = p.snaps;
    if (!s.length) continue;
    while (s.length > 2 && s[1].t < rt - 500) s.shift();
    let a = s[0], b = null;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || null; break; }
    const d = a.d;
    let x, y, z, yaw, pitch, roll, v, steer, vx, vz;
    if (b && rt >= a.t) {
      const f = clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1), e = b.d;
      x = lerp(d[0], e[0], f); y = lerp(d[1], e[1], f); z = lerp(d[2], e[2], f);
      yaw = angLerp(d[3], e[3], f); pitch = lerp(d[4], e[4], f); roll = lerp(d[5], e[5], f);
      v = lerp(d[6], e[6], f); steer = lerp(d[7], e[7], f);
      vx = e[10] ?? Math.sin(yaw) * v; vz = e[11] ?? Math.cos(yaw) * v;
    } else {
      const ex = clamp((rt - a.t) / 1000, 0, 0.25);
      x = d[0] + Math.sin(d[3]) * d[6] * ex; y = d[1]; z = d[2] + Math.cos(d[3]) * d[6] * ex;
      yaw = d[3]; pitch = d[4]; roll = d[5]; v = d[6]; steer = d[7];
      vx = d[10] ?? Math.sin(yaw) * v; vz = d[11] ?? Math.cos(yaw) * v;
    }
    const flags = s[s.length - 1].d[8] | 0;
    p.prog = s[s.length - 1].d[9] || 0;
    p.disp = { x, y, z, yaw, pitch, roll, v, steer, vx, vz, drift: !!(flags & 4), boost: !!(flags & 2) };
    p.flags = flags;
    p.disp.hidden = !!(flags & 64);
    p.model.root.visible = !p.disp.hidden;
    poseModel(p.model, p.disp, dt);
    if (Math.hypot(x - car.x, z - car.z) < 150) carFx(p.disp, false, dt);
  }
}

/* ================= 네트워크 ================= */
function send(o) { if (G.ws && G.ws.readyState === 1) G.ws.send(JSON.stringify(o)); }
let reconnectTimer = null;
// 접속할 게임 서버: net-config.js 의 PR_SERVER(예: Render 주소) → 없으면 이 페이지를 준 서버.
// GitHub Pages(github.io)처럼 게임 서버가 없는 곳에서는 혼자 하기(오프라인).
const SERVER = (window.PR_SERVER || '').replace(/\/+$/, '') || (location.hostname.endsWith('github.io') ? '' : location.origin);
const WS_URL = SERVER.replace(/^http/, 'ws');
let everOpened = false;
function goOffline() {
  G.offline = true;
  clearTimeout(reconnectTimer);
  if (G.ws && !G.ws.offline) { G.ws.onclose = null; try { G.ws.close(); } catch (e) { /* ignore */ } }
  $('conn').classList.add('hidden');
  document.body.classList.add('offline');
  G.ws = makeLocalServer(onMsg);
}
function connect() {
  if (!WS_URL) { goOffline(); return; }
  const ws = new WebSocket(WS_URL);
  G.ws = ws;
  ws.onopen = () => {
    everOpened = true;
    $('conn').classList.add('hidden');
    if (G.session) send({ t: 'auth', session: G.session });
    else showScreen('login');
  };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (er) { return; } onMsg(m); };
  ws.onclose = () => {
    if (G.room) { G.wantRejoin = G.room.code; leaveLocal(); }
    if (G.offline) return;
    $('connMsg').textContent = everOpened ? '서버 연결이 끊겼어요. 다시 연결 중...' : '서버에 연결하는 중... (무료 서버가 자고 있으면 1분쯤 걸려요)';
    $('offlineBtn').classList.toggle('hidden', everOpened);
    $('conn').classList.remove('hidden');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };
}

function onMsg(m) {
  if (m.t.startsWith('gp') || m.t === 'gi') { gpMsg(m); return; }
  switch (m.t) {
    case 'authed':
      G.session = m.session; if (!G.offline) lsSet('pr_session', m.session);
      G.me = m.profile;
      updateProfileUI();
      if (G.wantRejoin) { send({ t: 'join', code: G.wantRejoin }); G.wantRejoin = null; }
      if (!G.room) showScreen('lobby');
      break;
    case 'authFail':
      G.session = null; lsSet('pr_session', null);
      $('loginErr').textContent = m.msg || '';
      showScreen('login');
      break;
    case 'rooms': renderRooms(m.list); break;
    case 'err': toast(m.msg, true); sfx.err(); break;
    case 'joined': onJoined(m); break;
    case 'pj': addPlayer(m.p); break;
    case 'pl': removePlayer(m.id); break;
    case 'pu': addPlayer(m.p); break;
    case 'host': G.hostId = m.id; renderPlayerList(); if (m.id === G.myId) toast('이제 당신이 방장이에요'); break;
    case 'st': {
      const now = performance.now();
      for (const id in m.ps) {
        if (id === G.myId) continue;
        const p = G.players.get(id);
        if (p) { p.snaps.push({ t: now, d: m.ps[id] }); if (p.snaps.length > 30) p.snaps.shift(); }
      }
      break;
    }
    case 'coinGone': setCoin(m.id, false); break;
    case 'coinUp': for (const id of m.ids) setCoin(id, true); break;
    case 'coins': {
      G.me.coins = m.coins; updateProfileUI();
      gainPop('+' + m.gain);
      break;
    }
    case 'prof': {
      const old = G.me;
      G.me = m.p;
      updateProfileUI();
      if (G.room && (old.car !== G.me.car || old.color !== G.me.color)) rebuildMyCar();
      if (m.bought) { sfx.buy(); toast(W.carById[m.bought].name + ' 구매 완료!'); }
      if (G.garageOpen) renderGarage();
      break;
    }
    case 'chat': addChat(m.name, m.msg, m.id); break;
    case 'sys': addChat(null, m.msg); break;
    case 'honk': {
      const p = G.players.get(m.id);
      if (p && p.disp && Math.hypot(p.disp.x - car.x, p.disp.z - car.z) < 120) sfx.honk();
      break;
    }
    case 'raceStart': onRaceStart(m.race); break;
    case 'fin': onFinish(m); break;
    case 'raceEnd': onRaceEnd(m); break;
    case 'bump': {
      if (!car.model || !Array.isArray(m.dv)) break;
      car.vx += clamp(+m.dv[0] || 0, -40, 40); car.vz += clamp(+m.dv[1] || 0, -40, 40);
      car.yawRate += clamp(+m.w || 0, -4, 4);
      car.bumpT = 0.8;
      const k = Math.hypot(m.dv[0], m.dv[1]);
      sfx.crash(k * 2); camState.shake = Math.min(0.7, k * 0.05);
      for (let i = 0; i < 8; i++) spawnPart(car.x, car.y + 1, car.z, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, i % 2 ? 0xffd040 : 0xffffff, 0.4, 0.7);
      break;
    }
    case 'cpSync': if (G.race) G.race.c = m.c; break;
    case 'pong': break;
  }
}

function onJoined(m) {
  G.room = m.room; G.myId = m.you; G.hostId = m.room.host;
  clearPlayers();
  for (const p of m.players) addPlayer(p);
  for (let i = 0; i < coinUp.length; i++) setCoin(i, true);
  for (const id of m.coinsDown) setCoin(id, false);
  rebuildMyCar();
  spawnCar(m.spawn.x, m.spawn.z, m.spawn.yaw);
  $('chatlog').innerHTML = '';
  $('rName').textContent = G.room.name;
  $('rCode').textContent = G.room.code;
  G.race = null;
  showScreen('play');
  if (m.race) onRaceStart(m.race, true);
  if (m.room.kind === 'gp') { enterGP(m); addChat(null, `레이싱 방 ${G.room.code} — 방장이 설정하고, 모두 준비하면 시작해요!`); }
  else { leaveGP(); addChat(null, `방 코드 ${G.room.code} — 친구에게 알려주면 같이 달릴 수 있어요!`); }
  renderPlayerList();
}
function leaveLocal() {
  leaveGP();
  G.room = null; G.race = null; G.myId = null;
  clearPlayers();
  gate.visible = false;
  if (car.model) { scene.remove(car.model.root); car.model = null; }
  G.menuOpen = false; $('menu').classList.add('hidden');
  $('results').classList.add('hidden');
  $('racebox').classList.add('hidden'); $('big').classList.add('hidden'); $('wrongway').classList.add('hidden');
}

/* ================= 레이스 ================= */
function onRaceStart(r, late) {
  const t = W.trackById[r.track];
  const now = performance.now();
  G.race = {
    track: r.track, laps: r.laps, startAt: now + r.startIn, grid: r.grid, finished: r.finished || [],
    inRace: G.myId in r.grid && !late, slot: r.grid[G.myId], c: 0, done: false, wrongT: 0, lastBeep: 99,
  };
  closeGarage(); G.menuOpen = false; $('menu').classList.add('hidden'); $('results').classList.add('hidden');
  if (G.race.inRace) {
    const s = W.gridSlot(t, G.race.slot);
    spawnCar(s.x, s.z, s.yaw);
    toast(`${t.name} · ${r.laps}바퀴 레이스!`);
  } else {
    toast('레이스가 진행 중이에요. 끝나면 다음 레이스에 참가할 수 있어요.');
  }
  $('racebox').classList.remove('hidden');
}
function onFinish(m) {
  const r = G.race;
  if (r) r.finished.push(m);
  if (m.id === G.myId) {
    if (r) r.done = true;
    sfx.finish();
    bigText(m.place + '등!', 3000);
    toast(`${fmtTime(m.time)} · +${m.reward} 코인`);
  } else {
    toast(`${m.name} 님 ${m.place}등 도착 (${fmtTime(m.time)})`);
  }
}
function onRaceEnd(m) {
  G.race = null;
  gate.visible = false;
  $('racebox').classList.add('hidden'); $('wrongway').classList.add('hidden');
  if (m.cancelled) { toast('레이스가 취소됐어요'); return; }
  const rows = m.results.map(r => `<tr class="${r.id === G.myId ? 'me' : ''}"><td>${r.place ? r.place + '등' : 'DNF'}</td><td>${esc(r.name)}</td><td>${fmtTime(r.time)}</td><td>${r.reward ? '+' + r.reward : ''}</td></tr>`).join('');
  $('resTable').innerHTML = rows;
  $('results').classList.remove('hidden');
}
function raceStep(now) {
  const r = G.race;
  if (!r) { gate.visible = false; return; }
  const t = W.trackById[r.track], n = t.cps.length, total = r.laps * n + 1;
  // 카운트다운
  if (r.inRace) {
    const left = (r.startAt - now) / 1000;
    if (left > 0) {
      const k = Math.ceil(left);
      if (k <= 3 && k !== r.lastBeep) { r.lastBeep = k; sfx.beep(); }
      bigText(k <= 3 ? String(k) : '준비', 0);
    } else if (r.lastBeep !== 0) { r.lastBeep = 0; sfx.go(); bigText('GO!', 900); }
  }
  // 체크포인트
  if (r.inRace && !r.done && now >= r.startAt && r.c < total) {
    const i = r.c % n, cp = t.path[t.cps[i]];
    const dist = Math.hypot(car.x - cp[0], car.z - cp[1]);
    if (dist < t.w * 0.8 && car.y < 8) {
      r.c++;
      send({ t: 'cp', i, x: car.x, z: car.z });
      if (r.c === total) { /* 서버 확인 대기 */ }
      else if (i === 0 && r.c > 1) { sfx.lap(); const lap = Math.floor((r.c - 1) / n) + 1; bigText(lap === r.laps ? '마지막 바퀴!' : `${lap} / ${r.laps} 바퀴`, 1400, true); }
      else sfx.cp();
    }
    const ni = r.c % n, pi = (r.c - 1 + n) % n;
    const np = t.path[t.cps[ni]], pp = t.path[t.cps[pi]];
    const seg = Math.hypot(np[0] - pp[0], np[1] - pp[1]) || 1;
    r.prog = r.c + clamp(1 - Math.hypot(car.x - np[0], car.z - np[1]) / seg, 0, 0.99);
    // 게이트
    const idx = t.cps[ni], tg = t.tan[idx];
    gate.visible = true;
    gate.position.set(np[0], W.groundHeight(np[0], np[1]), np[1]);
    gate.rotation.y = Math.atan2(tg[0], tg[1]);
    gate.setWidth(t.w + 3);
    gate.setColor(r.c === total - 1 ? 0xffd84a : 0x40e0ff);
    // 역주행
    const near = W.nearestOnTrack(t, car.x, car.z, 1);
    const tt = t.tan[near.i];
    const along = car.vx * tt[0] + car.vz * tt[1];
    r.wrongT = along < -4 && near.d < t.w ? r.wrongT + 1 / 60 : 0;
  } else gate.visible = false;
  $('wrongway').classList.toggle('hidden', !(r.wrongT > 1.2));

  // HUD
  const racers = Object.keys(r.grid);
  const place = {};
  r.finished.forEach(f => { place[f.id] = f.place; });
  const ranked = racers.slice().sort((a, b) => {
    const pa = place[a], pb = place[b];
    if (pa && pb) return pa - pb;
    if (pa) return -1; if (pb) return 1;
    const ga = a === G.myId ? (r.prog || 0) : (G.players.get(a)?.prog || 0);
    const gb = b === G.myId ? (r.prog || 0) : (G.players.get(b)?.prog || 0);
    return gb - ga;
  });
  let html;
  if (r.inRace) {
    const lap = clamp(Math.floor(Math.max(0, r.c - 1) / n) + 1, 1, r.laps);
    const myPos = ranked.indexOf(G.myId) + 1;
    const time = now < r.startAt ? 0 : (r.done ? (r.finished.find(f => f.id === G.myId)?.time || 0) : now - r.startAt);
    html = `<div><span class="k">순위</span><span class="pos">${myPos}/${racers.length}</span></div>
      <div><span class="k">바퀴</span>${r.done ? '완주!' : lap + '/' + r.laps}</div>
      <div><span class="k">시간</span>${fmtTime(time)}</div>`;
  } else {
    html = `<div><span class="k">레이스 진행 중</span>${ranked.slice(0, 3).map((id, i) => (i + 1) + '. ' + esc(id === G.myId ? G.me.name : (G.players.get(id)?.name || '?'))).join(' &nbsp; ')}</div>`;
  }
  if (html !== r.lastHtml) { $('racebox').innerHTML = html; r.lastHtml = html; }
}

/* ================= 코인 줍기 ================= */
function coinStep(dt) {
  const t = performance.now() / 1000;
  const cy = car.y + 1;
  for (let i = 0; i < coinMeshes.length; i++) {
    if (!coinUp[i]) continue;
    const m = coinMeshes[i], c = W.coins[i];
    m.rotation.y = t * 2.5 + i;
    m.position.y = c.y + Math.sin(t * 2 + i) * 0.25;
    if (G.screen !== 'play' || GP.active) continue;
    const dx = c.x - car.x, dz = c.z - car.z;
    if (dx * dx + dz * dz < 10.5 && Math.abs(c.y - cy) < 3) {
      setCoin(i, false);
      send({ t: 'coin', id: i });
      if (c.big) sfx.gem(); else sfx.coin();
      for (let k = 0; k < (c.big ? 14 : 7); k++) spawnPart(c.x, c.y, c.z, (Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.5) * 8, c.big ? 0x40f0a0 : 0xffd040, 0.6, 0.9);
    }
  }
  void dt;
}

/* ================= 미니맵 ================= */
const MAP_PX = 640, MAP_S = MAP_PX / (W.HALF * 2);
const toMap = (x, z) => [(W.HALF - x) * MAP_S, (W.HALF - z) * MAP_S];
const baseMap = document.createElement('canvas');
baseMap.width = baseMap.height = MAP_PX;
{
  const g = baseMap.getContext('2d');
  g.fillStyle = '#4f9530'; g.fillRect(0, 0, MAP_PX, MAP_PX);
  const rect = (x1, z1, x2, z2, col) => { const [a, b] = toMap(x2, z2), [c, d] = toMap(x1, z1); g.fillStyle = col; g.fillRect(a, b, c - a, d - b); };
  rect(W.PARK.x1, W.PARK.z1, W.PARK.x2, W.PARK.z2, '#8b6a45');
  rect(W.CITY.x1, W.CITY.z1, W.CITY.x2, W.CITY.z2, '#a8a69e');
  g.fillStyle = '#2f6a22';
  for (const t of W.trees) { const [x, y] = toMap(t.x, t.z); g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); }
  g.lineCap = 'square';
  for (const s of W.roads) {
    g.strokeStyle = '#5a5a60'; g.lineWidth = s.w * MAP_S;
    const [a, b] = toMap(s.x1, s.z1), [c, d] = toMap(s.x2, s.z2);
    g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke();
  }
  const c0 = W.tracks[0];
  g.strokeStyle = '#d83a3a'; g.lineWidth = (c0.w + 4) * MAP_S; g.lineJoin = 'round';
  g.beginPath(); c0.path.forEach((p, i) => { const [x, y] = toMap(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
  g.strokeStyle = '#3e3e44'; g.lineWidth = c0.w * MAP_S;
  g.stroke();
  for (const b of W.buildings) rect(b.x1, b.z1, b.x2, b.z2, '#6a6a72');
  for (const r of W.ramps) { const [x, y] = toMap(r.cx, r.cz); g.fillStyle = '#e0c040'; g.fillRect(x - 2, y - 2, 4, 4); }
  for (const b of W.boosts) { const [x, y] = toMap(b.cx, b.cz); g.fillStyle = '#ff8020'; g.fillRect(x - 2, y - 2, 4, 4); }
}
const mm = $('minimap').getContext('2d'), bm = $('bigmapc').getContext('2d');
mm.imageSmoothingEnabled = false; bm.imageSmoothingEnabled = false;
function drawArrow(g, x, y, yaw, col, size) {
  // 지도 좌표계: 오른쪽 = -x, 위 = +z  → 화면 각도
  const a = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  g.save(); g.translate(x, y); g.rotate(a);
  g.fillStyle = '#000';
  g.beginPath(); g.moveTo(size + 1.5, 0); g.lineTo(-size - 1, -size - 1); g.lineTo(-size - 1, size + 1); g.closePath(); g.fill();
  g.fillStyle = col;
  g.beginPath(); g.moveTo(size, 0); g.lineTo(-size, -size + 0.5); g.lineTo(-size, size - 0.5); g.closePath(); g.fill();
  g.restore();
}
function drawMaps() {
  if (G.screen !== 'play') return;
  if (GP.active) { gpDrawMap(mm); if (G.bigmap) gpDrawMap(bm, true); return; }
  const Z = 1.6, view = 180 / Z;
  const [cx, cy] = toMap(car.x, car.z);
  mm.fillStyle = '#4f9530'; mm.fillRect(0, 0, 180, 180);
  mm.drawImage(baseMap, cx - view / 2, cy - view / 2, view, view, 0, 0, 180, 180);
  const tm = (x, z) => { const [a, b] = toMap(x, z); return [(a - cx) * Z + 90, (b - cy) * Z + 90]; };
  if (G.race && gate.visible) {
    const [gx, gy] = tm(gate.position.x, gate.position.z);
    mm.fillStyle = '#40e0ff'; mm.fillRect(clamp(gx, 4, 176) - 3, clamp(gy, 4, 176) - 3, 6, 6);
  }
  for (const p of G.players.values()) {
    if (!p.disp) continue;
    const [x, y] = tm(p.disp.x, p.disp.z);
    drawArrow(mm, clamp(x, 4, 176), clamp(y, 4, 176), p.disp.yaw, colorCss(p.color), 4);
  }
  drawArrow(mm, 90, 90, car.yaw, '#ffffff', 5);
  if (G.bigmap) {
    bm.drawImage(baseMap, 0, 0);
    for (let i = 0; i < W.coins.length; i++) if (coinUp[i]) { const [x, y] = toMap(W.coins[i].x, W.coins[i].z); bm.fillStyle = W.coins[i].big ? '#40f0a0' : '#ffd040'; bm.fillRect(x - 1, y - 1, 2, 2); }
    for (const p of G.players.values()) if (p.disp) { const [x, y] = toMap(p.disp.x, p.disp.z); drawArrow(bm, x, y, p.disp.yaw, colorCss(p.color), 6); bm.fillStyle = '#fff'; bm.font = '11px Galmuri11'; bm.fillText(p.name, x + 8, y - 6); }
    const [x, y] = toMap(car.x, car.z);
    drawArrow(bm, x, y, car.yaw, '#ffffff', 7);
  }
}

/* ================= UI ================= */
function showScreen(s) {
  G.screen = s;
  $('loading').classList.toggle('hidden', s !== 'loading');
  $('login').classList.toggle('hidden', s !== 'login');
  $('lobby').classList.toggle('hidden', s !== 'lobby');
  $('hud').classList.toggle('hidden', s !== 'play');
  $('touch').classList.toggle('hidden', !(s === 'play' && G.touch));
  if (s === 'play') { keepAwake(); if (G.touch && innerHeight > innerWidth && !G.rotHint) { G.rotHint = true; setTimeout(() => toast('휴대폰을 가로로 눕히면 더 넓게 보여요'), 1500); } }
  if (s !== 'play') { $('bigmap').classList.add('hidden'); G.bigmap = false; }
  if (s === 'lobby') send({ t: 'rooms' });
}
function updateProfileUI() {
  const p = G.me;
  if (!p) return;
  $('myName').textContent = p.name;
  $('acctTag').textContent = p.google ? '구글 계정 (자동 저장)' : '게스트';
  $('saveGoogleBtn').classList.toggle('hidden', !!p.google || !G.cfg.googleClientId);
  $('myCoins').textContent = p.coins;
  $('hCoins').textContent = p.coins;
  $('gCoins').textContent = p.coins;
}
function toast(msg, bad) {
  const d = document.createElement('div');
  d.className = 'toast dark';
  if (bad) d.style.color = '#ff8a7a';
  d.textContent = msg;
  const box = G.screen === 'play' ? $('toasts') : document.body;
  if (G.screen !== 'play') Object.assign(d.style, { position: 'fixed', left: '50%', top: '14px', transform: 'translateX(-50%)', zIndex: 70 });
  box.appendChild(d);
  setTimeout(() => d.remove(), 3000);
}
function gainPop(text) {
  const d = document.createElement('div');
  d.className = 'gainpop'; d.textContent = text;
  $('hud').appendChild(d);
  setTimeout(() => d.remove(), 900);
}
let bigTimer = null;
function bigText(text, ms, small) {
  const b = $('big');
  b.textContent = text; b.classList.remove('hidden'); b.classList.toggle('small', !!small);
  clearTimeout(bigTimer);
  if (ms) bigTimer = setTimeout(() => b.classList.add('hidden'), ms);
}

function renderRooms(list) {
  const el = $('roomList');
  if (!list.length) { el.innerHTML = '<div class="empty">열린 공개 방이 없어요.<br>새 방을 만들거나 빠른 참가를 눌러보세요!</div>'; return; }
  el.innerHTML = list.map(r => `<div class="room" data-code="${r.code}">
    <span class="rn">${esc(r.name)}</span><span class="rc">${r.code}</span>
    ${r.kind === 'gp' ? '<span class="tag gp">레이싱</span>' : ''}<span class="tag ${r.racing ? 'race' : 'free'}">${r.racing ? '레이스 중' : (r.kind === 'gp' ? '대기 중' : '자유 주행')}</span><span>${r.n}/${r.max}</span></div>`).join('');
  el.querySelectorAll('.room').forEach(d => d.onclick = () => { sfx.click(); send({ t: 'join', code: d.dataset.code }); });
}
function renderPlayerList() {
  if (!G.room || !G.me) return;
  const rows = [{ id: G.myId, name: G.me.name, color: G.me.color }, ...[...G.players.values()]];
  $('plist').innerHTML = rows.map(p => `<div><span class="dot" style="background:${colorCss(p.color)}"></span>${esc(p.name)}${p.id === G.hostId ? ' <span class="tag">방장</span>' : ''}${p.id === G.myId ? ' <span class="muted">(나)</span>' : ''}</div>`).join('')
    + `<div style="margin-top:4px"><button class="btn small" id="menuBtn2" style="width:100%">${G.touch ? '메뉴' : '메뉴 (Esc)'}</button></div>`;
  $('menuBtn2').onclick = () => toggleMenu();
}
function addChat(name, msg, id) {
  const d = document.createElement('div');
  if (name == null) { d.className = 'sys'; d.textContent = msg; }
  else {
    const col = id === G.myId ? colorCss(G.me.color) : colorCss(G.players.get(id)?.color ?? 4);
    d.innerHTML = `<span style="color:${col}">${esc(name)}</span>: ${esc(msg)}`;
  }
  const log = $('chatlog');
  log.appendChild(d);
  while (log.children.length > 8) log.firstChild.remove();
  setTimeout(() => { d.style.opacity = '0.0'; d.style.transition = 'opacity 1s'; }, 15000);
}
function openChat() { G.chatOpen = true; $('chatform').classList.remove('hidden'); const i = $('chatin'); i.value = ''; i.focus(); for (const k in keys) keys[k] = false; }
function closeChat() { G.chatOpen = false; $('chatin').blur(); $('chatform').classList.add('hidden'); }
function sendChat() { const i = $('chatin'), v = i.value.trim(); i.value = ''; if (v) send({ t: 'chat', msg: v }); closeChat(); }
$('chatform').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
// 휴대폰에서 입력창 밖을 누르면 닫기
$('chatin').addEventListener('blur', () => { if (G.touch && G.chatOpen) setTimeout(() => { if (document.activeElement !== $('chatin') && G.chatOpen) closeChat(); }, 200); });

function toggleMenu(force) {
  G.menuOpen = force ?? !G.menuOpen;
  $('menu').classList.toggle('hidden', !G.menuOpen);
  if (G.menuOpen) {
    for (const k in keys) keys[k] = false;
    const host = G.myId === G.hostId, racing = !!G.race;
    $('mRaceHost').classList.toggle('hidden', !host || racing);
    $('mRaceCancel').classList.toggle('hidden', !host || !racing);
    $('mRaceNote').textContent = !host ? '레이스는 방장이 시작할 수 있어요.' : (racing ? '레이스 진행 중' : '출발선으로 모두 이동해서 카운트다운 후 출발해요.');
    $('mGarage').disabled = (racing && G.race.inRace && !G.race.done) || GP.inRace();
    syncSettingsUI();
  }
}
function syncSettingsUI() {
  document.querySelectorAll('#mPix button').forEach(b => b.classList.toggle('on', +b.dataset.v === settings.pix));
  document.querySelectorAll('#mShadow button').forEach(b => b.classList.toggle('on', +b.dataset.v === settings.shadow));
  $('mVol').value = settings.vol;
  document.querySelectorAll('#mSteer button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.steer));
  document.querySelectorAll('#mAuto button').forEach(b => b.classList.toggle('on', +b.dataset.v === +settings.autoGas));
}

/* ---------- 차고 ---------- */
let gSel = null;
const prev = { renderer: null, scene: null, cam: null, model: null, key: '' };
function openGarage() {
  G.garageOpen = true;
  gSel = G.me.car;
  $('garage').classList.remove('hidden');
  if (!prev.renderer) {
    prev.renderer = new THREE.WebGLRenderer({ canvas: $('preview'), antialias: false });
    prev.renderer.setPixelRatio(1);
    prev.renderer.setSize(160, 120, false);
    prev.scene = new THREE.Scene();
    prev.scene.background = new THREE.Color(0x7fb2e8);
    prev.scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.3));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(5, 8, 6); prev.scene.add(dl);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.3, 12), new THREE.MeshLambertMaterial({ map: T.concrete }));
    floor.position.y = -0.15; prev.scene.add(floor);
    prev.cam = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 100);
    prev.cam.position.set(6.5, 3.6, 7.5); prev.cam.lookAt(0, 0.8, 0);
  }
  renderGarage();
}
function closeGarage() { G.garageOpen = false; $('garage').classList.add('hidden'); }
function renderGarage() {
  const me = G.me;
  $('gCoins').textContent = me.coins;
  $('carList').innerHTML = W.CARS.map(c => {
    const own = me.owned.includes(c.id);
    return `<div class="caritem ${c.id === gSel ? 'sel' : ''}" data-id="${c.id}"><span>${c.name}</span>${own ? `<span class="own">${c.id === me.car ? '사용 중' : '보유'}</span>` : `<span class="pr"><span class="coin-ico"></span> ${c.price}</span>`}</div>`;
  }).join('');
  $('carList').querySelectorAll('.caritem').forEach(d => d.onclick = () => { sfx.click(); gSel = d.dataset.id; renderGarage(); });
  $('colorList').innerHTML = W.COLORS.map((c, i) => `<div class="sw ${i === me.color ? 'sel' : ''}" data-i="${i}" style="background:${colorCss(i)}"></div>`).join('');
  $('colorList').querySelectorAll('.sw').forEach(d => d.onclick = () => { sfx.click(); send({ t: 'select', color: +d.dataset.i }); });
  const c = W.carById[gSel];
  $('gName').textContent = c.name;
  $('gDesc').textContent = c.desc;
  const top = W.CARS[W.CARS.length - 1];
  const stat = (name, v, max, label) => `<div class="stat">${name} <span class="muted">${label}</span><div class="bar"><i style="width:${Math.round(clamp(v / max, 0.05, 1) * 100)}%"></i></div></div>`;
  $('gStats').innerHTML = stat('최고 속도', c.maxV, top.maxV, Math.round(c.maxV * 3.6) + ' km/h') + stat('가속', c.acc, top.acc, '') +
    stat('핸들링', c.turn, 2.9, '') + stat('접지력', c.grip, 10, '') + stat('무게 (충돌)', c.mass, 4.5, '') + `<div class="stat">비포장 주행: ${c.off ? '강함' : '약함'}</div>`;
  const btn = $('gAction'), own = me.owned.includes(c.id);
  btn.disabled = false;
  if (own && c.id === me.car) { btn.textContent = '사용 중'; btn.disabled = true; btn.className = 'btn'; }
  else if (own) { btn.textContent = '이 차 타기'; btn.className = 'btn green'; btn.onclick = () => send({ t: 'select', car: c.id }); }
  else {
    btn.className = 'btn gold';
    btn.textContent = `구매하기 (${c.price} 코인)`;
    btn.disabled = me.coins < c.price;
    if (me.coins < c.price) btn.textContent = `코인 부족 (${me.coins}/${c.price})`;
    btn.onclick = () => send({ t: 'buy', car: c.id });
  }
}
function renderPreview(dt) {
  const key = gSel + ':' + G.me.color;
  if (prev.key !== key) {
    if (prev.model) prev.scene.remove(prev.model.root);
    prev.model = makeCar(gSel, G.me.color);
    prev.scene.add(prev.model.root);
    prev.key = key;
    const k = Math.max(1, carShape(gSel).len / 4.6);
    prev.cam.position.set(6.5 * k, 3.6 * k, 7.5 * k); prev.cam.lookAt(0, 0.8 * k, 0);
  }
  prev.model.root.rotation.y += dt * 0.8;
  prev.renderer.render(prev.scene, prev.cam);
}

/* ---------- 버튼 연결 ---------- */
let roomPub = true;
$('pubBtn').onclick = () => { roomPub = true; $('pubBtn').classList.add('on'); $('privBtn').classList.remove('on'); };
$('privBtn').onclick = () => { roomPub = false; $('privBtn').classList.add('on'); $('pubBtn').classList.remove('on'); };
let roomKind = 'free';
$('kindFree').onclick = () => { roomKind = 'free'; $('kindFree').classList.add('on'); $('kindGp').classList.remove('on'); $('kindNote').textContent = '맵을 돌아다니며 코인을 모으고, 방장이 가끔 레이스를 열어요.'; };
$('kindGp').onclick = () => { roomKind = 'gp'; $('kindGp').classList.add('on'); $('kindFree').classList.remove('on'); $('kindNote').textContent = '전용 트랙에서 스피드전/아이템전, 예선과 시즌 포인트로 경쟁해요.'; };
$('createBtn').onclick = () => { sfx.click(); send({ t: 'create', kind: roomKind, name: $('roomName').value || '', pub: roomPub, max: +$('maxSel').value }); };
$('joinBtn').onclick = () => { const c = $('codeIn').value.trim().toUpperCase(); if (c) send({ t: 'join', code: c }); };
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('quickBtn').onclick = () => { sfx.click(); send({ t: 'quick' }); };
$('refreshBtn').onclick = () => send({ t: 'rooms' });
$('garageBtn').onclick = () => { sfx.click(); openGarage(); };
$('gClose').onclick = closeGarage;
$('renameBtn').onclick = () => {
  const n = prompt('새 닉네임 (최대 12자)', G.me.name);
  if (n && n.trim()) send({ t: 'name', name: n.trim() });
};
// 게스트 → 구글 계정으로 옮기기 (같은 브라우저의 게스트 기록이 새 구글 계정으로 합쳐짐)
$('saveGoogleBtn').onclick = () => {
  $('loginInfo').textContent = '구글로 로그인하면 지금까지 모은 코인과 차가 구글 계정에 저장돼서 다른 기기에서도 이어서 할 수 있어요. (처음 쓰는 구글 계정일 때만 합쳐져요)';
  $('loginInfo').classList.remove('hidden');
  showScreen('login');
};
$('logoutBtn').onclick = () => {
  lsSet('pr_session', null); G.session = null;
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch (e) { /* ignore */ }
  location.reload();
};
$('guestBtn').onclick = () => {
  initAudio();
  let tok = lsGet('pr_guest');
  if (!tok) { tok = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); lsSet('pr_guest', tok); }
  const name = $('guestName').value.trim();
  if (!name) { $('loginErr').textContent = '닉네임을 입력해 주세요'; return; }
  lsSet('pr_name', name);
  send({ t: 'auth', guest: tok, name });
};
$('guestName').value = lsGet('pr_name') || '';
$('guestName').addEventListener('keydown', e => { if (e.key === 'Enter') $('guestBtn').click(); });
$('rCode').onclick = () => { navigator.clipboard?.writeText(G.room.code).then(() => toast('방 코드 복사됨: ' + G.room.code)).catch(() => {}); };
$('mResume').onclick = () => toggleMenu(false);
$('mGarage').onclick = () => { toggleMenu(false); openGarage(); };
$('mLobby').onclick = () => { toggleMenu(false); toggleLobby(); };
$('c3d').addEventListener('pointerdown', () => { if (GP.spectating()) nextSpectate(); });
$('mLeave').onclick = () => { send({ t: 'leave' }); leaveLocal(); showScreen('lobby'); };
$('mRaceStart').onclick = () => { send({ t: 'race', track: $('mTrack').value, laps: +$('mLaps').value }); toggleMenu(false); };
$('mRaceCancel').onclick = () => { send({ t: 'raceCancel' }); toggleMenu(false); };
$('mTrack').innerHTML = W.tracks.map(t => `<option value="${t.id}">${t.name} (${(t.length / 1000).toFixed(1)}km)</option>`).join('');
document.querySelectorAll('#mPix button').forEach(b => b.onclick = () => { settings.pix = +b.dataset.v; saveSettings(); resize(); syncSettingsUI(); });
document.querySelectorAll('#mShadow button').forEach(b => b.onclick = () => {
  settings.shadow = +b.dataset.v; saveSettings();
  renderer.shadowMap.enabled = !!settings.shadow;
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  syncSettingsUI();
});
document.querySelectorAll('#mSteer button').forEach(b => b.onclick = () => { settings.steer = b.dataset.v; saveSettings(); applyTouchSettings(); syncSettingsUI(); });
document.querySelectorAll('#mAuto button').forEach(b => b.onclick = () => { settings.autoGas = +b.dataset.v; saveSettings(); applyTouchSettings(); syncSettingsUI(); });
applyTouchSettings();
$('mVol').oninput = () => { settings.vol = +$('mVol').value; setVolume(settings.vol / 100 * 0.8); saveSettings(); };
setVolume(settings.vol / 100 * 0.8);
$('resClose').onclick = () => $('results').classList.add('hidden');

/* ---------- 구글 로그인 ---------- */
async function setupGoogle() {
  const id = G.cfg.googleClientId;
  if (!id) {
    const n = $('gnote');
    n.innerHTML = !SERVER
      ? '지금은 <b>혼자 하기 (오프라인)</b> 모드예요. 코인과 차는 이 브라우저에 저장돼요.<br>친구와 같이 하고 구글 계정에 저장하려면 게임 서버(Render)가 필요해요.'
      : '구글 로그인은 아직 설정되지 않았어요.<br>race 폴더의 <b>config.json</b> 에 googleClientId 를 넣으면 켜져요 (README 참고).';
    n.classList.remove('hidden');
    return;
  }
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  }).catch(() => { $('gnote').textContent = '구글 로그인 스크립트를 불러오지 못했어요.'; $('gnote').classList.remove('hidden'); });
  if (!window.google) return;
  google.accounts.id.initialize({
    client_id: id,
    callback: resp => { initAudio(); send({ t: 'auth', google: resp.credential, guest: lsGet('pr_guest') || undefined }); },
  });
  google.accounts.id.renderButton($('gbtn'), { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'ko', width: 300 });
}

/* ================= 메인 루프 ================= */
let last = performance.now(), acc = 0;
const STEP = 1 / 60;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  G.time += dt;

  if (G.screen === 'play' && car.model) {
    acc += dt;
    while (acc >= STEP) { if (!GP.spectating()) physics(STEP); acc -= STEP; }
    const s = { x: car.x, y: car.y, z: car.z, yaw: car.yaw, pitch: car.pitch, roll: car.roll, v: car.vf, steer: car.steer, drift: car.drifting, boost: car.boostT > 0 };
    poseModel(car.model, s, dt);
    carFx(s, true, dt);
    if (!GP.active) raceStep(now);
    gpFrame(dt, now);
    const sp = Math.hypot(car.vx, car.vz);
    $('spd').textContent = Math.round(sp * 3.6);
    engine(sp / car.def.maxV, car.input?.up ? 1 : 0, true);
    if (now - G.lastSend > 66) {
      G.lastSend = now;
      const r2 = v => Math.round(v * 100) / 100;
      const flags = (car.input?.down ? 1 : 0) | (car.boostT > 0 ? 2 : 0) | (car.drifting ? 4 : 0) | (GP.active ? GP.flags() : 0);
      send({ t: 's', d: [r2(car.x), r2(car.y), r2(car.z), r2(car.yaw), r2(car.pitch), r2(car.roll), r2(car.vf), r2(car.steer), flags, r2(GP.active ? GP.prog() : (G.race?.prog || 0)), r2(car.vx), r2(car.vz)] });
    }
  } else engine(0, 0, false);

  updateRemotes(now, dt);
  coinStep(dt);
  updateParts(dt);
  T.boost.offset.y = (T.boost.offset.y - dt * 1.5) % 1;
  updateCamera(dt);
  renderer.render(scene, camera);
  drawMaps();
  if (G.garageOpen && prev.renderer) renderPreview(dt);
}

/* ================= 시작 ================= */
initGP({ scene, camera, hemi, sun, T, car, G, send, spawnCar, toast, bigText, sfx, fmtTime, esc, colorCss, worldRoot, coinGroup, spawnPart, camState, openGarage, leaveRoom: () => $('mLeave').click() });
if (COARSE) setTouch(true);
window.__pr = { G, car, spawnCar, physics, step: n => { for (let i = 0; i < n; i++) { physics(STEP); gpFrame(STEP, performance.now()); } } };
try { G.cfg = SERVER ? await (await fetch(SERVER + '/config.json', { cache: 'no-cache' })).json() : {}; } catch (e) { G.cfg = {}; }
$('offlineBtn').onclick = () => goOffline();
setupGoogle();
requestAnimationFrame(frame);
connect();
setInterval(() => send({ t: 'ping', n: Date.now() }), 20000);
