// 레이싱 방 (그랑프리) 클라이언트: 경기장, 대기실, 예선/결승, 아이템전/스피드전, 결과
import * as THREE from './lib/three.module.min.js';
import { canvasOf, tex } from './tex.js';
import { ribbon, startLine, gantry, boxUV, flatQuad, wedgeGeo } from './models.js';

const W = WORLD;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let X = null; // game.js 가 넘겨주는 공용 객체

export const GP = {
  active: false,
  frozen: () => !!(S.run && S.inRun && performance.now() < S.startAt),
  ghost: () => !!(S.run && S.run.phase === 'quali'),
  spectating: () => !!(S.run && !S.inRun),
  flags: () => (X.car.trapT > 0 ? 8 : 0) | (X.car.shieldT > 0 ? 16 : 0) | (X.car.spinT > 0 ? 32 : 0) | (GP.spectating() ? 64 : 0),
  prog: () => S.prog || 0,
  inRace: () => !!(S.run && S.inRun && !S.done),
};

const S = {
  room: null, arena: null, run: null, inRun: false, startAt: 0, endAt: 0,
  c: 0, prog: 0, lapStart: 0, laps: [], best: null, done: false, finished: [], fastest: null, qbest: {},
  items: [], gauge: 0, nitro: 0, lobbyOpen: true, spect: null, wrongT: 0, lastBeep: 99, missileWarn: 0,
};

/* ================= 테마 ================= */
const THEMES = {
  grass: { sky: 0x86b8ec, fog: 0x9cc4ec, near: 220, far: 850, hemi: [0xdfefff, 0x5a7040, 1.1], sun: [0xfff2dc, 1.9], bar: [0xd83a3a, 0xf2f2f2], deco: 'tree' },
  desert: { sky: 0xf0d6a0, fog: 0xf2dcae, near: 180, far: 760, hemi: [0xfff0d8, 0xa08050, 1.15], sun: [0xffe2b8, 2.0], bar: [0xe0782a, 0x3a3a3a], deco: 'cactus' },
  snow: { sky: 0xb8d0ea, fog: 0xdce8f4, near: 150, far: 650, hemi: [0xffffff, 0x8090a8, 1.25], sun: [0xffffff, 1.6], bar: [0x3a6fd8, 0xf2f2f2], deco: 'pine' },
  beach: { sky: 0x7fd4f0, fog: 0xb8e8f4, near: 220, far: 850, hemi: [0xffffff, 0xc8b080, 1.2], sun: [0xfff0d0, 2.0], bar: [0x38c8c8, 0xf2f2f2], deco: 'palm' },
  canyon: { sky: 0xf0a868, fog: 0xe8a070, near: 160, far: 700, hemi: [0xffd8b0, 0x8a4a2a, 1.05], sun: [0xffc890, 1.9], bar: [0xf2c230, 0x3a2a22], deco: 'rock' },
  night: { sky: 0x0a0e24, fog: 0x0e1230, near: 90, far: 460, hemi: [0x7080c0, 0x101020, 0.5], sun: [0x8090ff, 0.45], bar: [0xff3aa8, 0x3ae8ff], deco: 'neon', glow: true },
};
let defTheme = null;
function applyTheme(th) {
  const { scene, hemi, sun } = X;
  if (!defTheme) defTheme = { sky: scene.background.getHex(), fog: scene.fog.color.getHex(), near: scene.fog.near, far: scene.fog.far, hemi: [hemi.color.getHex(), hemi.groundColor.getHex(), hemi.intensity], sun: [sun.color.getHex(), sun.intensity] };
  scene.background.setHex(th.sky);
  scene.fog.color.setHex(th.fog); scene.fog.near = th.near; scene.fog.far = th.far;
  hemi.color.setHex(th.hemi[0]); hemi.groundColor.setHex(th.hemi[1]); hemi.intensity = th.hemi[2];
  sun.color.setHex(th.sun[0]); sun.intensity = th.sun[1];
}

/* ================= 텍스처 ================= */
let TX = null;
function makeTex() {
  const R = W.rng(4242), pick = a => a[Math.floor(R() * a.length)];
  const asph = ['#45464c', '#4a4b51', '#404147', '#4f5057'];
  return {
    sand: tex(canvasOf(16, 16, () => pick(['#e0c080', '#d8b878', '#e8c888', '#d4b070', '#e0c080']))),
    sand2: tex(canvasOf(16, 16, (x, y) => (x + y) % 7 === 0 ? '#b89050' : pick(['#c8a060', '#c09858', '#d0a868']))),
    snow: tex(canvasOf(16, 16, () => pick(['#f4f8ff', '#eaf0fa', '#ffffff', '#e0e8f4']))),
    ice: tex(canvasOf(44, 16, (x, y) => {
      if (x === 1 || x === 42) return '#ffffff';
      if ((x * 3 + y * 5) % 23 === 0) return '#e8f8ff';
      return pick(['#9cc8e8', '#a8d0ec', '#94c0e0', '#a0cce8']);
    })),
    gravel: tex(canvasOf(16, 16, () => pick(['#9a968c', '#8c887e', '#a6a298', '#7e7a72']))),
    dark: tex(canvasOf(16, 16, (x, y) => (x % 8 === 0 || y % 8 === 0) ? '#2a2f5a' : pick(['#14162a', '#181a30', '#121426']))),
    neonRoad: tex(canvasOf(44, 16, (x, y) => {
      if (x === 1 || x === 42) return '#3ae8ff';
      if ((x === 21 || x === 22) && y < 8) return '#ff3aa8';
      return pick(['#26282e', '#2a2c33', '#23252b']);
    })),
    redrock: tex(canvasOf(16, 16, (x, y) => y % 6 === 5 ? '#8a3e22' : pick(['#b5603a', '#a8553a', '#c06a42', '#9e4e30']))),
    redrock2: tex(canvasOf(16, 16, () => pick(['#8a4a30', '#7e4228', '#965238', '#a05a3c']))),
    crowd: tex(canvasOf(16, 16, (x, y) => y % 4 === 3 ? '#6a6a6a' : pick(['#d83a3a', '#3a6fd8', '#f2c230', '#f2f2f2', '#3aa64a', '#2a2a2e', '#e0782a', '#f0c8a0']))),
    box: tex(canvasOf(16, 16, (x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return ['#ff5050', '#ffb030', '#f2e040', '#50e070', '#40c0ff', '#a060ff'][((x + y) >> 2) % 6];
      const Q = ['......', '.XXXX.', 'X....X', '....X.', '...X..', '...X..', '......', '...X..'];
      const qx = x - 5, qy = y - 4;
      if (qx >= 0 && qx < 6 && qy >= 0 && qy < 8 && Q[qy][qx] === 'X') return '#ffffff';
      return ['#6a5aff', '#7a6aff', '#5a4aef'][(x * 7 + y * 3) % 3];
    })),
    win: tex(canvasOf(16, 16, (x, y) => (y % 4 === 1 || y % 4 === 2) && x % 4 !== 0 ? pick(['#ff3aa8', '#3ae8ff', '#f2e040', '#1a1c30', '#1a1c30', '#1a1c30']) : '#101224')),
  };
}

/* ================= 아이템 아이콘 ================= */
const ITEM_NAME = { boost: '부스터', banana: '바나나', water: '물폭탄', missile: '미사일', shield: '실드', magnet: '자석', nitro: '니트로' };
const iconCache = {};
function icon(kind) {
  if (iconCache[kind]) return iconCache[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d'), px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const disc = (r1, r2, col) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d >= r1 && d < r2) px(x, y, 1, 1, col); } };
  switch (kind) {
    case 'boost': px(6, 1, 4, 2, '#ffe060'); px(5, 3, 6, 3, '#ffb030'); px(4, 6, 8, 5, '#ff7020'); px(5, 11, 6, 3, '#d84010'); px(7, 5, 2, 7, '#fff4b0'); break;
    case 'banana': px(2, 2, 2, 2, '#6a4a1a'); px(3, 4, 3, 3, '#f2d030'); px(4, 7, 3, 3, '#f2d030'); px(6, 10, 4, 3, '#f2d030'); px(9, 10, 4, 2, '#e8c020'); px(12, 8, 2, 2, '#e8c020'); px(13, 6, 2, 2, '#6a4a1a'); px(4, 5, 1, 4, '#fff08a'); break;
    case 'water': disc(0, 6.5, '#3a8ae0'); disc(0, 4.5, '#5aa8f0'); px(5, 4, 2, 2, '#ffffff'); px(7, 0, 2, 2, '#8a8a8a'); break;
    case 'missile': px(3, 6, 9, 4, '#d83a3a'); px(12, 7, 2, 2, '#f0f0f0'); px(11, 6, 1, 4, '#f0f0f0'); px(3, 3, 3, 3, '#8a8a8a'); px(3, 10, 3, 3, '#8a8a8a'); px(0, 7, 3, 2, '#ffa020'); px(5, 7, 5, 1, '#ff8a7a'); break;
    case 'shield': disc(5, 7.4, '#40e0ff'); disc(0, 5, 'rgba(64,224,255,0.3)'); px(4, 4, 2, 2, '#ffffff'); break;
    case 'magnet': px(3, 3, 3, 8, '#d83a3a'); px(10, 3, 3, 8, '#d83a3a'); px(3, 10, 10, 3, '#d83a3a'); px(3, 1, 3, 2, '#dddddd'); px(10, 1, 3, 2, '#dddddd'); px(4, 4, 1, 6, '#ff8a7a'); break;
    case 'nitro': px(5, 3, 6, 11, '#3a6fd8'); px(6, 1, 4, 2, '#aaaaaa'); px(5, 7, 6, 2, '#40e0ff'); px(6, 4, 1, 9, '#7aa8ff'); break;
  }
  return (iconCache[kind] = c.toDataURL());
}

/* ================= 경기장 만들기 ================= */
const arenaGroups = {};
const lam = o => new THREE.MeshLambertMaterial(o);
function buildArena(a) {
  const th = THEMES[a.theme], T = X.T, g = new THREE.Group();
  g.visible = false;
  X.scene.add(g);
  const add = (geo, mat, shadow) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; if (shadow) m.castShadow = true; g.add(m); return m; };
  const b = a.bounds, M = 320;
  const ground = { grass: T.grass, desert: TX.sand, snow: TX.snow, night: TX.dark, beach: TX.sand, canyon: TX.redrock }[a.theme];
  const runoff = { grass: TX.gravel, desert: TX.sand2, snow: TX.snow, night: TX.dark, beach: TX.sand2, canyon: TX.redrock2 }[a.theme];
  const road = { grass: T.roadTrack, desert: T.roadTrack, snow: TX.ice, night: TX.neonRoad, beach: T.roadTrack, canyon: T.roadTrack }[a.theme];
  // 해변: 동쪽은 바다
  if (a.theme === 'beach') add(flatQuad(b.x2 + 70, b.z1 - M, b.x2 + M + 400, b.z2 + M, 0.08, 4), lam({ map: T.water, emissive: 0x0a2a4a }));
  add(flatQuad(b.x1 - M, b.z1 - M, b.x2 + M, b.z2 + M, 0, 4), lam({ map: ground }));
  add(ribbon(a, -a.w / 2, a.w / 2, 0.06, 8), lam({ map: road }));
  add(ribbon(a, a.w / 2 + 1.6, a.wb + 0.5, 0.04, 4), lam({ map: runoff }));
  add(ribbon(a, -a.wb - 0.5, -a.w / 2 - 1.6, 0.04, 4), lam({ map: runoff }));
  const curbMat = th.glow ? new THREE.MeshBasicMaterial({ map: T.curb, color: 0xff80d0 }) : lam({ map: T.curb });
  add(ribbon(a, a.w / 2, a.w / 2 + 1.6, 0.09, 4), curbMat);
  add(ribbon(a, -a.w / 2 - 1.6, -a.w / 2, 0.09, 4), curbMat);
  g.add(startLine(a, T), gantry(a, T));

  // 벽 (타이어 벽 / 네온 블록)
  const n = a.barriers.length;
  const barMat = th.glow ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : lam({ color: 0xffffff });
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.3, 1), barMat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  a.barriers.forEach((s, i) => {
    const dx = s[2] - s[0], dz = s[3] - s[1], len = Math.hypot(dx, dz);
    q.setFromAxisAngle(up, Math.atan2(dx, dz));
    p.set((s[0] + s[2]) / 2 - s[4] * 0.5, 0.65, (s[1] + s[3]) / 2 - s[5] * 0.5);
    sc.set(1, 1, len + 0.25);
    m4.compose(p, q, sc);
    bars.setMatrixAt(i, m4);
    bars.setColorAt(i, col.setHex(th.bar[(i >> 2) % 2]));
  });
  bars.castShadow = !th.glow; bars.receiveShadow = true;
  g.add(bars);

  // 점프대 / 부스터
  const rampMats = [lam({ map: T.plank, side: THREE.DoubleSide }), lam({ map: T.hazard, side: THREE.DoubleSide })];
  for (const r of W.ramps) if (W.arenaAt(r.cx) === a) { const m = add(wedgeGeo(r), rampMats, true); m.position.set(r.cx, 0, r.cz); m.rotation.y = r.rot; }
  const bMat = lam({ map: T.boost, emissive: 0x552200 });
  for (const bs of a.boostSpecs) {
    const geo = new THREE.PlaneGeometry(bs.w, bs.len); geo.rotateX(-Math.PI / 2);
    const m = add(geo, bMat); m.position.set(bs.cx, 0.12, bs.cz); m.rotation.y = bs.rot;
  }

  // 관중석 (출발선 옆)
  {
    const p0 = a.path[6], tg = a.tan[6], nx = -tg[1], nz = tg[0];
    const st = new THREE.Group();
    st.position.set(p0[0] + nx * (a.wb + 9), 0, p0[1] + nz * (a.wb + 9));
    st.rotation.y = Math.atan2(tg[0], tg[1]);
    const crowd = lam({ map: TX.crowd }), conc = lam({ map: T.concrete });
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Mesh(boxUV(6, 1.2 + k * 1.2, 70, 4), [crowd, crowd, conc, conc, conc, conc]);
      m.position.set(k * 3 * (nx >= 0 ? 1 : 1), (1.2 + k * 1.2) / 2, 0);
      m.position.x = k * 3; m.castShadow = true; m.receiveShadow = true;
      st.add(m);
    }
    const roof = new THREE.Mesh(boxUV(18, 0.6, 72, 4), conc); roof.position.set(6, 9, 0); roof.castShadow = true; st.add(roof);
    g.add(st);
  }

  // 장식 (트랙 밖)
  const R = W.rng(a.id.length * 97 + 13);
  const spots = [];
  for (let k = 0; k < 900 && spots.length < 260; k++) {
    const x = b.x1 - 260 + R() * (b.x2 - b.x1 + 520), z = b.z1 - 260 + R() * (b.z2 - b.z1 + 520);
    if (a.theme === 'beach' && x > b.x2 + 60) continue;
    if (W.nearestOnTrack(a, x, z, 2).d > a.wb + 10) spots.push([x, z, 0.8 + R() * 0.7, Math.floor(R() * 4)]);
  }
  buildDeco(g, th.deco, spots, T);

  // 밤: 트랙 가로등
  if (th.glow) {
    const pts = [];
    for (let i = 0; i < a.path.length; i += 10) for (const s of [1, -1]) { const pp = a.path[i], tg = a.tan[i]; pts.push([pp[0] + tg[1] * s * (a.wb + 1.5), pp[1] - tg[0] * s * (a.wb + 1.5)]); }
    const pole = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 7, 0.3), lam({ color: 0x30344a }), pts.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }), pts.length);
    pts.forEach(([x, z], i) => { m4.makeTranslation(x, 3.5, z); pole.setMatrixAt(i, m4); m4.makeTranslation(x, 7.1, z); head.setMatrixAt(i, m4); });
    g.add(pole, head);
  }
  return g;
}
function buildDeco(g, kind, spots, T) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const parts = {
    tree: [[1, 4, 1, 0, 2, T.bark, 0xffffff], [5, 4, 5, 0, 5.5, T.leaves, 0xffffff], [3, 2, 3, 0, 8.5, T.leaves, 0xffffff]],
    cactus: [[1.2, 6, 1.2, 0, 3, null, 0x3a8a3a], [0.8, 2.4, 0.8, 1.2, 3.6, null, 0x3a8a3a], [0.8, 2, 0.8, -1.2, 2.8, null, 0x3a8a3a]],
    pine: [[1, 3, 1, 0, 1.5, T.bark, 0xffffff], [5, 2.5, 5, 0, 3.8, null, 0x2e5a3a], [3.6, 2.5, 3.6, 0, 6, null, 0x2e5a3a], [2, 2, 2, 0, 8, null, 0xf4f8ff]],
    palm: [[0.8, 8, 0.8, 0, 4, T.bark, 0xffffff], [7, 0.5, 1.6, 0, 8.2, null, 0x3a9a3a], [1.6, 0.5, 7, 0, 8.2, null, 0x3a9a3a], [1.6, 1.2, 1.6, 0, 8.6, null, 0x2e7a2e]],
    rock: [[6, 5, 6, 0, 2.5, null, 0x9a4a2a], [4.5, 3, 4.5, 0.6, 6.5, null, 0xb5603a], [2.5, 2, 2.5, -0.4, 9, null, 0xa8553a]],
    neon: [[8, 30, 8, 0, 15, 'win', 0xffffff], [8.6, 0.8, 8.6, 0, 30.4, null, 0xff3aa8]],
  }[kind];
  for (const [sx, sy, sz, ox, oy, map, color] of parts) {
    const mat = map === 'win' ? new THREE.MeshBasicMaterial({ map: TX.win }) : (kind === 'neon' && !map ? new THREE.MeshBasicMaterial({ color }) : lam({ map: map || null, color }));
    const inst = new THREE.InstancedMesh(boxUV(sx, sy, sz, 4), mat, spots.length);
    spots.forEach(([x, z, k, r], i) => {
      const hk = kind === 'neon' ? k * 1.6 : (kind === 'rock' ? k * 1.8 : k);
      q.setFromAxisAngle(up, r * Math.PI / 2);
      const c = Math.cos(r * Math.PI / 2), sn = Math.sin(r * Math.PI / 2);
      p.set(x + ox * c * k, oy * hk, z - ox * sn * k); s.set(k, hk, k);
      m4.compose(p, q, s); inst.setMatrixAt(i, m4);
    });
    inst.castShadow = kind !== 'neon';
    g.add(inst);
  }
}

/* ================= 미니맵 ================= */
const mapCache = {};
function mapOf(a) {
  if (mapCache[a.id]) return mapCache[a.id];
  const size = 640, b = a.bounds, span = Math.max(b.x2 - b.x1, b.z2 - b.z1) + 80, s = size / span;
  const cx = (b.x1 + b.x2) / 2, cz = (b.z1 + b.z2) / 2;
  const to = (x, z) => [size / 2 - (x - cx) * s, size / 2 - (z - cz) * s];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const th = THEMES[a.theme];
  g.fillStyle = { grass: '#4f9530', desert: '#c8a060', snow: '#dce6f2', night: '#10122a', beach: '#e0c888', canyon: '#a8583a' }[a.theme]; g.fillRect(0, 0, size, size);
  g.lineJoin = 'round';
  const path = () => { g.beginPath(); a.path.forEach((p, i) => { const [x, y] = to(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
  g.strokeStyle = '#' + th.bar[0].toString(16).padStart(6, '0'); g.lineWidth = (a.wb * 2 + 4) * s; path(); g.stroke();
  g.strokeStyle = a.theme === 'snow' ? '#8ab8e0' : '#3e3e44'; g.lineWidth = a.w * s * 1.4; path(); g.stroke();
  const [sx, sy] = to(a.path[0][0], a.path[0][1]);
  g.fillStyle = '#fff'; g.fillRect(sx - 4, sy - 2, 8, 4);
  return (mapCache[a.id] = { c, to, s });
}
export function drawMap(g, big) {
  if (!S.arena) return;
  const m = mapOf(S.arena), size = big ? 640 : 180, k = size / 640;
  g.drawImage(m.c, 0, 0, size, size);
  const dot = (x, z, col, r) => { const [a, b] = m.to(x, z); g.fillStyle = '#000'; g.fillRect(a * k - r - 1, b * k - r - 1, r * 2 + 2, r * 2 + 2); g.fillStyle = col; g.fillRect(a * k - r, b * k - r, r * 2, r * 2); };
  for (const ms of missiles) dot(ms.x, ms.z, '#ff3030', big ? 3 : 2);
  for (const p of X.G.players.values()) if (p.disp && !p.disp.hidden) dot(p.disp.x, p.disp.z, X.colorCss(p.color), big ? 5 : 3);
  if (!GP.spectating()) dot(X.car.x, X.car.z, '#ffffff', big ? 6 : 4);
}

/* ================= 아이템 박스 / 오브젝트 ================= */
let boxMeshes = [];
function buildBoxes(a) {
  for (const b of boxMeshes) X.scene.remove(b.m);
  boxMeshes = [];
  const geo = new THREE.BoxGeometry(1.8, 1.8, 1.8);
  const mat = new THREE.MeshLambertMaterial({ map: TX.box, emissive: 0x2a1a6a, transparent: true, opacity: 0.9 });
  for (const b of a.itemBoxes) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(b.x, 1.6, b.z);
    X.scene.add(m);
    boxMeshes.push({ m, x: b.x, z: b.z, back: 0 });
  }
  showBoxes();
}
function showBoxes() { const on = GP.active && mode() === 'item'; for (const b of boxMeshes) b.m.visible = on && !b.back; }
function mode() { return S.run ? S.run.mode : (S.room ? S.room.set.mode : 'speed'); }

const objs = new Map(); // id → {kind, x,z, mesh, t0, land...}
const missiles = [];
const fxMeshes = new Map(); // 플레이어별 실드/물방울
let G3 = null; // 공용 지오메트리/재질
function g3() {
  if (G3) return G3;
  const tm = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
  G3 = {
    bubble: new THREE.IcosahedronGeometry(2.9, 1),
    shieldMat: tm(0x40e0ff, 0.28), waterMat: tm(0x3a8ae0, 0.45),
    ball: new THREE.IcosahedronGeometry(0.9, 0), ballMat: new THREE.MeshLambertMaterial({ color: 0x3a8ae0, flatShading: true }),
    splash: new THREE.CylinderGeometry(5, 5, 0.3, 12), splashMat: tm(0x5aa8f0, 0.5),
    banana: new THREE.BoxGeometry(0.6, 0.6, 1.6), bananaMat: new THREE.MeshLambertMaterial({ color: 0xf2d030, emissive: 0x3a3000 }),
    missile: new THREE.BoxGeometry(0.5, 0.5, 2.2), missileMat: new THREE.MeshBasicMaterial({ color: 0xe03030 }),
  };
  return G3;
}
function spawnObj(m) {
  const G = g3(), o = { id: m.id, kind: m.kind, x: m.x, z: m.z, x2: m.x2, z2: m.z2, t0: performance.now(), hitBy: new Set() };
  if (m.kind === 'banana') {
    o.mesh = new THREE.Group();
    const b1 = new THREE.Mesh(G.banana, G.bananaMat); b1.rotation.y = 0.5; b1.position.x = -0.3;
    const b2 = new THREE.Mesh(G.banana, G.bananaMat); b2.rotation.y = -0.5; b2.position.x = 0.3;
    o.mesh.add(b1, b2);
    o.mesh.position.set(m.x, W.groundHeight(m.x, m.z) + 0.4, m.z);
  } else {
    o.mesh = new THREE.Mesh(G.ball, G.ballMat);
    o.splash = new THREE.Mesh(G.splash, G.splashMat); o.splash.visible = false;
    o.splash.position.set(m.x2, W.groundHeight(m.x2, m.z2) + 0.2, m.z2);
    X.scene.add(o.splash);
  }
  X.scene.add(o.mesh);
  objs.set(o.id, o);
}
function removeObj(id) {
  const o = objs.get(id);
  if (!o) return;
  X.scene.remove(o.mesh); if (o.splash) X.scene.remove(o.splash);
  objs.delete(id);
}
function clearObjs() { for (const id of [...objs.keys()]) removeObj(id); for (const m of missiles) X.scene.remove(m.mesh); missiles.length = 0; }

/* ================= 입장 / 퇴장 ================= */
export function initGP(ctx) {
  X = ctx;
  TX = makeTex();
  bindUI();
}
export function enterGP(joined) {
  GP.active = true;
  Object.assign(S, { room: null, run: null, inRun: false, finished: [], items: [], gauge: 0, nitro: 0, lobbyOpen: true, spect: null, qbest: {} });
  setArena(W.arenaAt(joined.spawn.x) || W.arenas[0]);
  $('gphud').classList.remove('hidden');
  $('mRaceSec').classList.add('hidden'); $('mLobby').classList.remove('hidden');
  openLobby(true);
  renderHud();
}
export function leaveGP() {
  if (!GP.active) return;
  GP.active = false;
  if (S.arena) arenaGroups[S.arena.id].visible = false;
  S.arena = null; S.run = null;
  for (const b of boxMeshes) X.scene.remove(b.m);
  boxMeshes = [];
  clearObjs();
  for (const m of fxMeshes.values()) { X.scene.remove(m.s); X.scene.remove(m.w); }
  fxMeshes.clear();
  X.worldRoot.visible = true; X.coinGroup.visible = true;
  if (defTheme) applyTheme(defTheme);
  for (const id of ['gphud', 'gplobby', 'gpres', 'itemBtn']) $(id).classList.add('hidden');
  $('mRaceSec').classList.remove('hidden'); $('mLobby').classList.add('hidden');
}
function setArena(a) {
  if (S.arena === a) return;
  if (S.arena) arenaGroups[S.arena.id].visible = false;
  S.arena = a;
  (arenaGroups[a.id] || (arenaGroups[a.id] = buildArena(a))).visible = true;
  X.worldRoot.visible = false; X.coinGroup.visible = false;
  applyTheme(THEMES[a.theme]);
  buildBoxes(a);
  clearObjs();
}
function mySlot() {
  const ids = S.room ? S.room.players.map(p => p.id) : [];
  return Math.max(0, ids.indexOf(X.G.myId)) % 12;
}
function toGrid(slot) {
  const s = W.gridSlot(S.arena, slot);
  X.spawnCar(s.x, s.z, s.yaw);
  resetEffects();
}
function resetEffects() {
  Object.assign(X.car, { trapT: 0, spinT: 0, shieldT: 0, magnetT: 0 });
}

/* ================= 메시지 ================= */
export function gpMsg(m) {
  const now = performance.now();
  switch (m.t) {
    case 'gpRoom': {
      const prevTrack = S.room?.set.track;
      S.room = m.room;
      const a = W.trackById[m.room.set.track];
      if (a !== S.arena) { setArena(a); if (!S.run) toGrid(mySlot()); }
      else if (!prevTrack) { /* 첫 수신 */ }
      showBoxes();
      renderLobby();
      break;
    }
    case 'gpRun': startRun(m.run, m.late); break;
    case 'gpSync': S.c = m.c; break;
    case 'gpLap': {
      if (S.run) S.qbest[m.id] = m.best;
      S.fastest = m.fastest;
      if (m.id === X.G.myId) {
        S.best = m.best;
        X.toast(`랩 ${m.lap}: ${X.fmtTime(m.time)}${m.fastest?.id === m.id && m.fastest.time === m.time ? '  (전체 최고 기록!)' : ''}`);
      }
      break;
    }
    case 'gpFin': {
      S.finished.push(m);
      S.endAt = now + m.endIn;
      if (m.id === X.G.myId) { S.done = true; X.sfx.finish(); X.bigText(m.place + '위!', 3000); }
      else X.toast(`${m.name} 님 ${m.place}위로 골인! (${X.fmtTime(m.time)})`);
      break;
    }
    case 'gpQres': {
      S.run = null;
      showResults('예선 결과 · 출발 순서', m.order.map((o, k) => `<tr class="${o.id === X.G.myId ? 'me' : ''}"><td>${k + 1}번 그리드</td><td>${X.esc(o.name)}</td><td>${X.fmtTime(o.best)}</td></tr>`).join(''), '곧 결승이 시작돼요');
      break;
    }
    case 'gpEnd': {
      S.run = null; S.spect = null;
      if (m.cancelled) { X.toast('레이스가 취소됐어요'); openLobby(true); break; }
      const win = m.results[0]?.time;
      const rows = m.results.map(r => {
        const team = r.team ? `<span class="tdot ${r.team}"></span>` : '';
        const gap = r.place === 1 || !r.time ? '' : '+' + ((r.time - win) / 1000).toFixed(2);
        return `<tr class="${r.id === X.G.myId ? 'me' : ''}"><td>${r.place ? r.place + '위' : '-'}</td><td>${team}${X.esc(r.name)}</td><td>${r.time ? X.fmtTime(r.time) : 'DNF'} <span class="muted">${gap}</span></td><td>${r.best ? X.fmtTime(r.best) : '-'}${r.fl ? ' <b class="fl">FL</b>' : ''}</td><td>+${r.pts}점</td><td>+${r.coins}</td></tr>`;
      }).join('');
      let foot = m.fastest ? `최고 랩: ${X.esc(m.fastest.name)} ${X.fmtTime(m.fastest.time)} (+1점)` : '';
      if (m.teams) foot = `<b class="red-t">레드팀 ${m.teams.red}점</b> vs <b class="blue-t">블루팀 ${m.teams.blue}점</b> → ${m.teams.red === m.teams.blue ? '무승부' : (m.teams.red > m.teams.blue ? '레드팀 승리!' : '블루팀 승리!')}<br>` + foot;
      showResults('결승 결과', '<tr class="hd"><td>순위</td><td>이름</td><td>기록</td><td>최고 랩</td><td>포인트</td><td>코인</td></tr>' + rows, foot);
      break;
    }
    case 'gpLobby':
      $('gpres').classList.add('hidden');
      S.run = null; S.items = []; S.nitro = 0; S.gauge = 0;
      toGrid(mySlot());
      openLobby(true);
      break;
    case 'gi': itemEvent(m); break;
  }
}

function startRun(run, late) {
  const now = performance.now();
  S.run = run;
  S.startAt = now + run.startIn;
  S.endAt = run.endIn ? now + run.endIn : 0;
  S.inRun = !late && X.G.myId in run.grid;
  Object.assign(S, { c: 0, prog: 0, lapStart: 0, laps: [], best: null, done: false, finished: run.finished || [], fastest: run.fastest, qbest: {}, items: [], gauge: 0, nitro: 0, lastBeep: 99, wrongT: 0, spect: null });
  setArena(W.trackById[run.track]);
  for (const b of boxMeshes) b.back = 0;
  showBoxes();
  clearObjs();
  openLobby(false);
  $('gpres').classList.add('hidden');
  if (S.inRun) {
    toGrid(run.grid[X.G.myId]);
    X.toast(run.phase === 'quali' ? '예선: 제한 시간 안에 가장 빠른 랩을 기록하세요! (충돌 없음)' : `결승 ${run.laps}바퀴 · ${run.mode === 'item' ? '아이템전' : '스피드전'}${run.team ? ' · 팀전' : ''}`);
  } else X.toast('레이스 진행 중이라 관전해요. 다음 레이스부터 참가!');
}

/* ================= 대기실 UI ================= */
function isHost() { return S.room && S.room.host === X.G.myId; }
function openLobby(on) {
  S.lobbyOpen = on && !S.run;
  $('gplobby').classList.toggle('hidden', !S.lobbyOpen);
  renderLobby();
}
export function toggleLobby() { if (!S.run && GP.active) openLobby(!S.lobbyOpen); }
function renderLobby() {
  if (!S.room || $('gplobby').classList.contains('hidden')) { renderHud(); return; }
  const r = S.room, host = isHost(), set = r.set, me = r.players.find(p => p.id === X.G.myId);
  const a = W.trackById[set.track];
  $('glTitle').textContent = `${X.G.room?.name || ''}  ·  코드 ${X.G.room?.code || ''}`;
  $('glTrack').innerHTML = W.arenas.map(t => `<option value="${t.id}" ${t.id === set.track ? 'selected' : ''}>${t.name} (${(t.length / 1000).toFixed(1)}km)</option>`).join('');
  $('glTrackDesc').textContent = a.desc;
  const seg = (id, v) => document.querySelectorAll(`#${id} button`).forEach(b => { b.classList.toggle('on', b.dataset.v === String(v)); b.disabled = !host; });
  seg('glMode', set.mode); seg('glTeam', set.team); seg('glQuali', set.quali); seg('glLaps', set.laps);
  $('glTrack').disabled = !host;
  $('glModeDesc').textContent = set.mode === 'item'
    ? '아이템전: 물음표 박스에서 아이템을 얻어 쓰세요. (E / Shift / 아이템 버튼)'
    : '스피드전: 드리프트로 게이지를 채우면 니트로! (E / Shift / 니트로 버튼)';
  const ranked = r.players.slice().sort((x, y) => y.pts - x.pts || y.wins - x.wins);
  $('glPlayers').innerHTML = r.players.map(p => {
    const car = W.carById[p.car]?.name || '';
    const badge = p.id === r.host ? '<span class="tag">방장</span>' : (p.ready ? '<span class="tag ready">준비 완료</span>' : '<span class="tag wait">대기 중</span>');
    const team = set.team ? `<span class="tdot ${p.team}"></span>` : `<span class="dot" style="background:${X.colorCss(p.color)}"></span>`;
    return `<div class="gl-p ${p.id === X.G.myId ? 'me' : ''}">${team}<span class="nm">${X.esc(p.name)}</span><span class="muted">${X.esc(car)}</span>${badge}</div>`;
  }).join('');
  $('glTeamBtns').classList.toggle('hidden', !set.team);
  $('glSeason').innerHTML = r.races ? ranked.map((p, k) => `<tr><td>${k + 1}</td><td>${X.esc(p.name)}</td><td>${p.pts}점</td><td>${p.wins}승</td></tr>`).join('') : '<tr><td class="muted">아직 치른 레이스가 없어요</td></tr>';
  $('glRaces').textContent = r.races ? `(${r.races}경기)` : '';
  const btn = $('glGo');
  if (host) {
    const waiting = r.players.filter(p => p.id !== r.host && !p.ready).length;
    btn.textContent = waiting ? `준비 기다리는 중 (${waiting}명)` : '게임 시작!';
    btn.disabled = waiting > 0 || r.phase !== 'lobby';
    btn.className = 'btn red';
  } else {
    btn.textContent = me?.ready ? '준비 취소' : '준비';
    btn.disabled = r.phase !== 'lobby';
    btn.className = me?.ready ? 'btn' : 'btn green';
  }
  $('glReset').classList.toggle('hidden', !host);
  $('glPhase').textContent = r.phase === 'lobby' ? '' : '레이스 진행 중...';
  renderHud();
}
function sendSet(patch) { if (isHost()) X.send({ t: 'gpSet', set: patch }); }
function bindUI() {
  $('glTrack').onchange = () => sendSet({ track: $('glTrack').value });
  const segBind = (id, parse) => document.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => { X.sfx.click(); sendSet(parse(b.dataset.v)); });
  segBind('glMode', v => ({ mode: v }));
  segBind('glTeam', v => ({ team: v === 'true' }));
  segBind('glQuali', v => ({ quali: v === 'true' }));
  segBind('glLaps', v => ({ laps: +v }));
  $('glGo').onclick = () => { X.sfx.click(); X.send({ t: isHost() ? 'gpStart' : 'gpReady' }); };
  $('glRed').onclick = () => X.send({ t: 'gpTeam', team: 'red' });
  $('glBlue').onclick = () => X.send({ t: 'gpTeam', team: 'blue' });
  $('glPractice').onclick = () => openLobby(false);
  $('glGarage').onclick = () => { openLobby(false); X.openGarage(); };
  $('glReset').onclick = () => { if (confirm('시즌 포인트를 모두 0으로 되돌릴까요?')) X.send({ t: 'gpReset' }); };
  $('glLeave').onclick = () => X.leaveRoom();
  $('gpLobbyBtn').onclick = () => toggleLobby();
  $('gpresClose').onclick = () => $('gpres').classList.add('hidden');
  const ib = $('itemBtn');
  ib.addEventListener('pointerdown', e => { e.preventDefault(); useItem(); });
}
function showResults(title, rows, foot) {
  $('gpresTitle').textContent = title;
  $('gpresTable').innerHTML = rows;
  $('gpresFoot').innerHTML = foot || '';
  $('gpres').classList.remove('hidden');
}

/* ================= 아이템 ================= */
function rankList() {
  const run = S.run;
  if (!run) return [];
  const me = X.G.myId, fin = {};
  S.finished.forEach(f => { fin[f.id] = f.place; });
  const prog = id => id === me ? S.prog : (X.G.players.get(id)?.prog || 0);
  return Object.keys(run.grid).filter(id => id === me || X.G.players.has(id))
    .sort((a, b) => (fin[a] || 99) - (fin[b] || 99) || prog(b) - prog(a));
}
function others() { return [...X.G.players.values()].filter(p => p.disp && !p.disp.hidden); }
function targetAhead() {
  const rl = rankList(), me = X.G.myId, i = rl.indexOf(me);
  if (i > 0) return rl[i - 1];
  // 1등이거나 순위가 없으면 가장 가까운 사람
  let best = null, bd = Infinity;
  for (const p of others()) { const d = Math.hypot(p.disp.x - X.car.x, p.disp.z - X.car.z); if (d < bd) { bd = d; best = p.id; } }
  return best;
}
function rollItem() {
  const rl = rankList(), n = rl.length, i = rl.indexOf(X.G.myId);
  const f = n > 1 && i >= 0 ? i / (n - 1) : 0.5;
  const solo = others().length === 0;
  const tbl = f < 0.34 ? { banana: 40, water: 25, shield: 20, boost: 15 }
    : f < 0.67 ? { boost: 25, banana: 15, water: 20, missile: 20, shield: 10, magnet: 10 }
      : { boost: 35, missile: 30, magnet: 25, water: 10 };
  if (solo) { delete tbl.missile; delete tbl.magnet; }
  let sum = 0; for (const k in tbl) sum += tbl[k];
  let r = Math.random() * sum;
  for (const k in tbl) { r -= tbl[k]; if (r <= 0) return k; }
  return 'boost';
}
export function useItem() {
  if (!GP.active || GP.spectating() || GP.frozen()) return;
  const car = X.car;
  if (car.trapT > 0) return;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), sp = Math.hypot(car.vx, car.vz);
  const boost = (mult, t) => {
    const vf = car.vx * fx + car.vz * fz, want = car.def.maxV * mult;
    if (vf < want) { car.vx += fx * (want - vf); car.vz += fz * (want - vf); }
    car.boostT = Math.max(car.boostT, t);
    X.sfx.boost();
  };
  if (mode() === 'speed') {
    if (S.nitro <= 0) return;
    S.nitro--; boost(1.35, 1.8);
    X.bigText('NITRO!', 700, true);
    renderHud();
    return;
  }
  const it = S.items.shift();
  if (!it) return;
  switch (it) {
    case 'boost': boost(1.4, 1.6); break;
    case 'banana': { const back = car.shape.len / 2 + 2; X.send({ t: 'gi', k: 'obj', kind: 'banana', x: car.x - fx * back, z: car.z - fz * back }); break; }
    case 'water': { const d = 30 + sp * 0.4; X.send({ t: 'gi', k: 'obj', kind: 'water', x: car.x, z: car.z, x2: car.x + fx * d, z2: car.z + fz * d }); X.sfx.item(); break; }
    case 'missile': { const to = targetAhead(); if (to) { X.send({ t: 'gi', k: 'missile', to }); X.sfx.boost(); } else X.toast('맞출 상대가 없어요'); break; }
    case 'shield': car.shieldT = 7; X.sfx.shield(); break;
    case 'magnet': { const to = targetAhead(); if (to) { car.magnetT = 2.5; car.magnetTo = to; X.sfx.item(); } break; }
  }
  renderHud();
}
export function swapItem() { if (S.items.length === 2) { S.items.reverse(); renderHud(); } }

function itemEvent(m) {
  const me = X.G.myId;
  if (m.k === 'obj') spawnObj(m);
  else if (m.k === 'rm') removeObj(m.id);
  else if (m.k === 'missile') {
    const src = m.from === me ? X.car : X.G.players.get(m.from)?.disp;
    if (!src) return;
    const mesh = new THREE.Mesh(g3().missile, g3().missileMat);
    mesh.position.set(src.x, src.y + 1.5, src.z);
    X.scene.add(mesh);
    missiles.push({ mesh, x: src.x, y: src.y + 1.5, z: src.z, to: m.to, from: m.from, t0: performance.now() });
    if (m.to === me) { S.missileWarn = performance.now(); X.bigText('미사일 경보!', 1200, true); X.sfx.warn(); }
  } else if (m.k === 'fx' && m.kind === 'hit') X.sfx.crash(6);
}
function hitMe(kind) {
  const car = X.car;
  if (car.shieldT > 0) { car.shieldT = 0; X.sfx.pop(); X.toast('실드가 막아줬어요!'); return; }
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  if (kind === 'banana') {
    car.spinT = 1.0; car.yawRate = (Math.random() < 0.5 ? -1 : 1) * 9;
    car.vx *= 0.45; car.vz *= 0.45;
  } else if (kind === 'water') {
    car.trapT = 1.8; X.sfx.splash();
  } else if (kind === 'missile') {
    car.spinT = 1.3; car.yawRate = 10; car.vx *= 0.2; car.vz *= 0.2;
    car.vy = 11; car.grounded = false;
    X.camState.shake = 0.6;
  }
  X.sfx.crash(10);
  for (let i = 0; i < 12; i++) X.spawnPart(car.x, car.y + 1, car.z, (Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8, kind === 'water' ? 0x5aa8f0 : 0xffd040, 0.6, 0.8);
  X.send({ t: 'gi', k: 'fx', kind: 'hit' });
  void fx; void fz;
}

/* ================= 물리 보정 (매 스텝) ================= */
export function prePhysics(dt, inp) {
  if (!GP.active) return inp;
  const car = X.car;
  car.shieldT = Math.max(0, (car.shieldT || 0) - dt);
  if (GP.spectating()) return { up: false, down: false, steer: 0, drift: false };
  if (car.trapT > 0) {
    car.trapT -= dt;
    car.vx *= Math.exp(-10 * dt); car.vz *= Math.exp(-10 * dt);
    return { up: false, down: false, steer: 0, drift: false };
  }
  if (car.spinT > 0) { car.spinT -= dt; return { up: false, down: false, steer: 0, drift: false }; }
  if (car.magnetT > 0) {
    car.magnetT -= dt;
    const p = X.G.players.get(car.magnetTo)?.disp;
    if (p) {
      const dx = p.x - car.x, dz = p.z - car.z, d = Math.hypot(dx, dz);
      if (d > 5) { car.vx += dx / d * 26 * dt; car.vz += dz / d * 26 * dt; }
      const sp = Math.hypot(car.vx, car.vz), lim = car.def.maxV * 1.25;
      if (sp > lim) { car.vx *= lim / sp; car.vz *= lim / sp; }
      if (Math.random() < 0.5) X.spawnPart(car.x, car.y + 1, car.z, dx / d * 10, 0.5, dz / d * 10, 0x60a0ff, 0.3, 0.6);
    }
  }
  // 스피드전: 드리프트로 니트로 게이지 충전
  if (mode() === 'speed' && !S.done && car.drifting) {
    S.gauge += Math.abs(car.vl) * dt * 5.5;
    if (S.gauge >= 100) {
      if (S.nitro < 2) { S.nitro++; S.gauge = 0; X.sfx.item(); renderHud(); }
      else S.gauge = 100;
    }
  }
  return inp;
}
export function respawnGP() {
  const a = S.arena, car = X.car;
  if (!a) return;
  if (S.run && S.inRun && S.c > 0 && !S.done) {
    const idx = a.cps[(S.c - 1) % a.cps.length], p = a.path[idx], tg = a.tan[idx];
    X.spawnCar(p[0], p[1], Math.atan2(tg[0], tg[1]));
  } else {
    const p = W.respawnPoint(car.x, car.z);
    X.spawnCar(p.x, p.z, p.yaw);
  }
  resetEffects();
}

/* ================= 매 프레임 ================= */
export function gpFrame(dt, now) {
  if (!GP.active || !S.arena) return;
  const car = X.car, a = S.arena, me = X.G.myId, run = S.run;
  const t = now / 1000;

  // 아이템 박스
  if (mode() === 'item') {
    for (const b of boxMeshes) {
      if (b.back && now > b.back) { b.back = 0; b.m.visible = true; }
      if (b.back) continue;
      b.m.rotation.y = t * 1.5; b.m.rotation.x = t * 0.7;
      b.m.position.y = 1.6 + Math.sin(t * 3 + b.x) * 0.2;
      if (!GP.spectating() && Math.hypot(car.x - b.x, car.z - b.z) < 2.6 && car.y < 4) {
        b.back = now + 2500; b.m.visible = false;
        if (S.items.length < 2) { S.items.push(rollItem()); X.sfx.item(); renderHud(); }
        for (let k = 0; k < 8; k++) X.spawnPart(b.x, 1.6, b.z, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0x9a80ff, 0.5, 0.7);
      }
    }
  }

  // 바나나 / 물폭탄
  for (const o of objs.values()) {
    const age = (now - o.t0) / 1000;
    if (o.kind === 'banana') {
      o.mesh.rotation.y = t * 2;
      if (age > 0.4 && !GP.spectating() && Math.hypot(car.x - o.x, car.z - o.z) < 2.2 && car.y < 3) { hitMe('banana'); X.send({ t: 'gi', k: 'rm', id: o.id }); removeObj(o.id); }
      if (age > 60) removeObj(o.id);
    } else {
      const fly = 0.7;
      if (age < fly) {
        const k = age / fly;
        o.mesh.position.set(o.x + (o.x2 - o.x) * k, 1.5 + Math.sin(k * Math.PI) * 8, o.z + (o.z2 - o.z) * k);
      } else {
        if (!o.splash.visible) { o.splash.visible = true; o.mesh.visible = false; X.sfx.splash(); }
        const s = 1 + Math.sin(t * 6) * 0.05;
        o.splash.scale.set(s, 1, s);
        if (Math.random() < 0.3) X.spawnPart(o.x2 + (Math.random() - 0.5) * 8, 0.5, o.z2 + (Math.random() - 0.5) * 8, 0, 2 + Math.random() * 2, 0, 0x8ac8ff, 0.5, 0.6);
        if (!GP.spectating() && !o.hitBy.has(me) && Math.hypot(car.x - o.x2, car.z - o.z2) < 5.2 && car.y < 4) { o.hitBy.add(me); hitMe('water'); }
        if (age > fly + 3.5) removeObj(o.id);
      }
    }
  }

  // 미사일
  for (let i = missiles.length - 1; i >= 0; i--) {
    const ms = missiles[i];
    const tgt = ms.to === me ? car : X.G.players.get(ms.to)?.disp;
    const age = (now - ms.t0) / 1000;
    if (!tgt || age > 5) { X.scene.remove(ms.mesh); missiles.splice(i, 1); continue; }
    const dx = tgt.x - ms.x, dy = (tgt.y + 1) - ms.y, dz = tgt.z - ms.z, d = Math.hypot(dx, dy, dz);
    const step = Math.min(d, (95 + age * 40) * dt);
    ms.x += dx / d * step; ms.y += dy / d * step; ms.z += dz / d * step;
    ms.mesh.position.set(ms.x, ms.y, ms.z);
    ms.mesh.lookAt(tgt.x, tgt.y + 1, tgt.z);
    if (Math.random() < 0.8) X.spawnPart(ms.x, ms.y, ms.z, 0, 0.5, 0, Math.random() < 0.5 ? 0xffa020 : 0xaaaaaa, 0.4, 0.8);
    if (d < 2.5) {
      if (ms.to === me) hitMe('missile');
      X.scene.remove(ms.mesh); missiles.splice(i, 1);
    }
  }

  // 실드 / 물방울 표시
  const showFx = (key, x, y, z, shield, trap) => {
    let f = fxMeshes.get(key);
    if (!f) {
      f = { s: new THREE.Mesh(g3().bubble, g3().shieldMat), w: new THREE.Mesh(g3().bubble, g3().waterMat) };
      X.scene.add(f.s, f.w); fxMeshes.set(key, f);
    }
    f.s.visible = shield; f.w.visible = trap;
    f.s.position.set(x, y + 1, z); f.w.position.set(x, y + 1.2, z);
    f.s.rotation.y = t; f.w.scale.setScalar(1 + Math.sin(t * 8) * 0.04);
  };
  showFx('me', car.x, car.y, car.z, car.shieldT > 0, car.trapT > 0);
  for (const p of X.G.players.values()) if (p.disp) showFx(p.id, p.disp.x, p.disp.y, p.disp.z, !!(p.flags & 16), !!(p.flags & 8));
  for (const [k, f] of fxMeshes) if (k !== 'me' && !X.G.players.has(k)) { X.scene.remove(f.s, f.w); fxMeshes.delete(k); }

  // 내 차 숨김 (관전)
  if (car.model) car.model.root.visible = !GP.spectating();

  // 레이스 진행
  if (run) {
    if (S.inRun) {
      const left = (S.startAt - now) / 1000;
      if (left > 0) {
        const k = Math.ceil(left);
        if (k <= 3 && k !== S.lastBeep) { S.lastBeep = k; X.sfx.beep(); }
        X.bigText(k <= 3 ? String(k) : (run.phase === 'quali' ? '예선 준비' : '결승 준비'), 0);
      } else if (S.lastBeep !== 0) { S.lastBeep = 0; X.sfx.go(); X.bigText('GO!', 900); }
    }
    const n = a.cps.length, total = run.phase === 'race' ? run.laps * n + 1 : Infinity;
    if (S.inRun && !S.done && now >= S.startAt) {
      const i = S.c % n, cp = a.path[a.cps[i]];
      if (Math.hypot(car.x - cp[0], car.z - cp[1]) < a.w * 0.9 && car.y < 9) {
        S.c++;
        X.send({ t: 'gpCp', i, x: car.x, z: car.z });
        if (i === 0) {
          if (S.c === 1) S.lapStart = run.phase === 'race' ? S.startAt : now;
          else {
            S.laps.push(now - S.lapStart); S.lapStart = now;
            const lap = Math.floor((S.c - 1) / n) + 1;
            if (run.phase === 'race' && S.c < total) { X.sfx.lap(); X.bigText(lap === run.laps ? 'FINAL LAP' : `LAP ${lap}/${run.laps}`, 1300, true); }
            else if (run.phase === 'quali') X.sfx.lap();
          }
        } else X.sfx.cp();
      }
      const ni = S.c % n, pi = (S.c - 1 + n) % n;
      const np = a.path[a.cps[ni]], pp = a.path[a.cps[pi]];
      const seg = Math.hypot(np[0] - pp[0], np[1] - pp[1]) || 1;
      S.prog = S.c + clamp(1 - Math.hypot(car.x - np[0], car.z - np[1]) / seg, 0, 0.99);
      const near = W.nearestOnTrack(a, car.x, car.z, 1), tt = a.tan[near.i];
      S.wrongT = (car.vx * tt[0] + car.vz * tt[1]) < -4 ? S.wrongT + dt : 0;
    } else S.wrongT = 0;
    $('wrongway').classList.toggle('hidden', !(S.wrongT > 1.2));
  }
  hudTick(now);
}

/* ================= 관전 카메라 ================= */
export function camTarget() {
  if (!GP.active || !GP.spectating()) return null;
  const rl = rankList().filter(id => id !== X.G.myId);
  if (!rl.length) return null;
  if (!S.spect || !rl.includes(S.spect)) S.spect = rl[0];
  const p = X.G.players.get(S.spect);
  if (!p || !p.disp) return null;
  const d = p.disp;
  return { x: d.x, y: d.y, z: d.z, yaw: d.yaw, vx: d.vx, vz: d.vz, vf: d.v, pitch: d.pitch, grounded: true, boostT: 0, shape: p.shape };
}
export function nextSpectate() {
  const rl = rankList().filter(id => id !== X.G.myId);
  if (!rl.length) return;
  S.spect = rl[(rl.indexOf(S.spect) + 1) % rl.length];
}

/* ================= HUD ================= */
let lastBoard = '', lastTop = '';
function nameOf(id) { return id === X.G.myId ? X.G.me.name : (S.room?.players.find(p => p.id === id)?.name || X.G.players.get(id)?.name || '?'); }
function teamOf(id) { return S.room?.set.team ? S.room.players.find(p => p.id === id)?.team : null; }
function renderHud() {
  if (!GP.active) return;
  const m = mode(), inRace = !!S.run;
  // 아이템 / 니트로
  const slots = $('gpSlots');
  let html = '';
  if (m === 'item') {
    for (let i = 0; i < 2; i++) { const it = S.items[i]; html += `<div class="slot ${i === 0 ? 'main' : ''}">${it ? `<img src="${icon(it)}" alt=""><span>${ITEM_NAME[it]}</span>` : ''}</div>`; }
    html += '<div class="keys">E / Shift 사용 · Q 바꾸기</div>';
  } else {
    for (let i = 0; i < 2; i++) html += `<div class="slot ${i < S.nitro ? 'full' : ''}">${i < S.nitro ? `<img src="${icon('nitro')}" alt="">` : ''}</div>`;
    html += `<div class="gauge"><i style="width:${Math.min(100, S.gauge)}%"></i></div><div class="keys">드리프트로 충전 · E / Shift 니트로</div>`;
  }
  slots.innerHTML = html;
  const ib = $('itemBtn');
  ib.classList.toggle('hidden', !(X.G.touch && GP.active && !GP.spectating()));
  const main = m === 'item' ? S.items[0] : (S.nitro > 0 ? 'nitro' : null);
  ib.innerHTML = main ? `<img src="${icon(main)}" alt="">` : `<span>${m === 'item' ? '아이템' : '니트로'}</span>`;
  ib.classList.toggle('ready', !!main);
  $('gpLobbyBtn').classList.toggle('hidden', inRace || S.lobbyOpen);
}
function hudTick(now) {
  const run = S.run, a = S.arena;
  const gauge = document.querySelector('#gpSlots .gauge i');
  if (gauge) gauge.style.width = Math.min(100, S.gauge) + '%';
  let top = '', board = '';
  if (!run) {
    top = `<div class="gp-k">${S.room?.phase === 'lobby' || !S.room ? '연습 주행 · ' + a.name : '다음 레이스 준비 중'}</div>`;
  } else if (run.phase === 'quali') {
    const left = Math.max(0, (S.startAt + 75000 - now) / 1000);
    const cur = S.lapStart ? now - S.lapStart : 0;
    top = `<div><span class="gp-k">예선 남은 시간</span><b class="gp-big">${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}</b></div>
      <div><span class="gp-k">현재 랩</span>${S.inRun && S.lapStart ? X.fmtTime(cur) : '-'}</div><div><span class="gp-k">내 최고</span>${X.fmtTime(S.best)}</div>`;
    const ids = Object.keys(run.grid).sort((x, y) => (S.qbest[x] ?? Infinity) - (S.qbest[y] ?? Infinity));
    board = ids.map((id, k) => `<div class="${id === X.G.myId ? 'me' : ''}"><b>${k + 1}</b> ${X.esc(nameOf(id))} <span>${S.qbest[id] ? X.fmtTime(S.qbest[id]) : '-'}</span></div>`).join('');
  } else {
    const rl = rankList(), n = a.cps.length;
    const lap = clamp(Math.floor(Math.max(0, S.c - 1) / n) + 1, 1, run.laps);
    const pos = rl.indexOf(X.G.myId) + 1;
    const time = now < S.startAt ? 0 : (S.done ? (S.finished.find(f => f.id === X.G.myId)?.time || 0) : now - S.startAt);
    if (S.inRun) {
      top = `<div class="gp-pos">${pos || '-'}<small>/${rl.length}</small></div>
        <div><span class="gp-k">바퀴</span><b class="gp-big">${S.done ? '완주' : lap + '/' + run.laps}</b></div>
        <div><span class="gp-k">시간</span>${X.fmtTime(time)}</div><div><span class="gp-k">최고 랩</span>${X.fmtTime(S.best)}</div>`;
    } else {
      const sp = S.spect ? nameOf(S.spect) : '';
      top = `<div><span class="gp-k">관전 중</span><b>${X.esc(sp)}</b> <span class="muted">(클릭/Space: 다른 사람)</span></div>`;
    }
    if (S.endAt && now < S.endAt && !S.done) top += `<div class="gp-retire">종료까지 ${Math.ceil((S.endAt - now) / 1000)}초!</div>`;
    const fin = {}; S.finished.forEach(f => { fin[f.id] = f; });
    board = rl.map((id, k) => {
      const tm = teamOf(id), f = fin[id];
      return `<div class="${id === X.G.myId ? 'me' : ''}"><b>${k + 1}</b>${tm ? `<span class="tdot ${tm}"></span>` : ''} ${X.esc(nameOf(id))}${f ? ` <span>${X.fmtTime(f.time)}</span>` : ''}</div>`;
    }).join('');
  }
  if (top !== lastTop) { $('gpTop').innerHTML = top; lastTop = top; }
  if (board !== lastBoard) { $('gpBoard').innerHTML = board; lastBoard = board; }
  $('gpBoard').classList.toggle('hidden', !board);
}
