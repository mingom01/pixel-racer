// 레이싱 방 (그랑프리) 클라이언트: 경기장, 대기실, 예선/결승, 아이템전/스피드전, 결과
import * as THREE from './lib/three.module.min.js';
import { canvasOf, tex, signTexture } from './tex.js?v=mvjm6cjq';
import { ribbon, startLine, gantry, boxUV, flatQuad, wedgeGeo } from './models.js?v=mvjm6cjq';

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
  autumn: { sky: 0xa8c8e8, fog: 0xe0d0b8, near: 200, far: 780, hemi: [0xfff0e0, 0x7a5a30, 1.1], sun: [0xffe0b0, 1.8], bar: [0xe0782a, 0xf2f2f2], deco: 'maple' },
  volcano: { sky: 0x3a1a1a, fog: 0x4a2018, near: 120, far: 560, hemi: [0xffb08a, 0x2a1010, 0.85], sun: [0xff9a60, 1.3], bar: [0xf2c230, 0x2a2a2e], deco: 'lava' },
  port: { sky: 0x9ab8d0, fog: 0xb0c4d4, near: 200, far: 800, hemi: [0xe8f0ff, 0x606870, 1.1], sun: [0xfff4e0, 1.8], bar: [0xf2c230, 0x2a2a2e], deco: 'container' },
  rainbow: { sky: 0x140c38, fog: 0x1e1250, near: 130, far: 620, hemi: [0xa090ff, 0x201040, 0.75], sun: [0xc0b0ff, 0.8], bar: [0xff5aa8, 0x5ae8ff], deco: 'star', glow: true },
  jungle: { sky: 0x8ac8a0, fog: 0x9ad0a8, near: 140, far: 600, hemi: [0xe0ffe0, 0x3a5a2a, 1.1], sun: [0xfff0c0, 1.7], bar: [0x3aa64a, 0xf2c230], deco: 'jungle' },
  dusk: { sky: 0xf0a080, fog: 0xe8a888, near: 220, far: 850, hemi: [0xffd0c0, 0x5a5040, 1.0], sun: [0xffa070, 1.7], bar: [0xd83a3a, 0xf2f2f2], deco: 'tree' },
  sky: { sky: 0x8ccaff, fog: 0xd8ecff, near: 240, far: 900, hemi: [0xffffff, 0xb8d0f0, 1.25], sun: [0xfff8e8, 1.8], bar: [0xffffff, 0x3ab8ff], deco: 'cloud', deck: 'TX.cloudDeck' },
  factory: { sky: 0x5a5662, fog: 0x6a6470, near: 150, far: 650, hemi: [0xffe0c0, 0x3a3436, 0.95], sun: [0xffc890, 1.5], bar: [0xf2c230, 0x2a2a2e], deco: 'chimney', deck: 'TX.metal2' },
  tomb: { sky: 0xf2d8a0, fog: 0xe8c890, near: 200, far: 800, hemi: [0xfff0d0, 0xa08050, 1.15], sun: [0xffe0a8, 2.0], bar: [0xc89a5a, 0x6a4a2a], deco: 'pyramid', deck: 'TX.sandstone' },
};
// 테마별 바닥 / 코스 밖 / 노면 텍스처 이름 (T.xxx 또는 TX.xxx), 미니맵 바탕색
const GROUND = {
  grass: ['T.grass', 'TX.gravel', 'T.roadTrack', '#4f9530'], desert: ['TX.sand', 'TX.sand2', 'T.roadTrack', '#c8a060'],
  snow: ['TX.snow', 'TX.snow', 'TX.ice', '#dce6f2'], night: ['TX.dark', 'TX.dark', 'TX.neonRoad', '#10122a'],
  beach: ['TX.sand', 'TX.sand2', 'T.roadTrack', '#e0c888'], canyon: ['TX.redrock', 'TX.redrock2', 'T.roadTrack', '#a8583a'],
  autumn: ['TX.leaf', 'TX.gravel', 'T.roadTrack', '#8a7a34'], volcano: ['TX.basalt', 'TX.lava', 'T.roadTrack', '#2a1a18'],
  port: ['T.concrete', 'TX.gravel', 'T.roadTrack', '#8a8c90'], rainbow: ['TX.space', 'TX.space', 'TX.rainbowRoad', '#1a1040'],
  jungle: ['TX.jungle', 'TX.mud', 'TX.dirtRoad', '#2e6a2a'], dusk: ['T.grass', 'TX.gravel', 'T.roadTrack', '#5a7a30'],
  sky: ['TX.cloud', 'TX.cloudDeck', 'T.roadTrack', '#cfe6ff'], factory: ['TX.metal', 'TX.metal2', 'T.roadTrack', '#4a4a52'],
  tomb: ['TX.sand', 'TX.sandstone', 'TX.stoneRoad', '#d8b070'],
};
const texOf = name => { const [o, k] = name.split('.'); return (o === 'T' ? X.T : TX)[k]; };
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
    leaf: tex(canvasOf(16, 16, () => pick(['#b8762a', '#a86a26', '#d89a3a', '#8a7a3a', '#c05a2a', '#7a8a3a', '#6a7a32', '#8a8a3a']))),
    basalt: tex(canvasOf(16, 16, (x, y) => (x * 5 + y * 3) % 17 === 0 ? '#5a2a1a' : pick(['#2a2426', '#322a2a', '#262022', '#3a302e']))),
    lava: tex(canvasOf(16, 16, (x, y) => ((x + y * 2) % 9 < 2) ? '#ffd040' : pick(['#ff6a1a', '#f0501a', '#ff8a2a', '#d8401a']))),
    space: tex(canvasOf(16, 16, (x, y) => (x * 7 + y * 13) % 41 === 0 ? '#ffffff' : (x * 3 + y * 11) % 53 === 0 ? '#8ae8ff' : pick(['#140c38', '#180e40', '#120a32', '#1c1048']))),
    rainbowRoad: tex(canvasOf(44, 16, (x, y) => {
      if (x === 1 || x === 42) return '#ffffff';
      const band = ['#ff4a4a', '#ff9a2a', '#ffe23a', '#4ae05a', '#3ab8ff', '#5a6aff', '#c25aff'][Math.max(0, Math.min(6, Math.floor((x - 2) / 40 * 7)))];
      return y % 8 === 0 ? '#ffffff' : band;
    })),
    jungle: tex(canvasOf(16, 16, () => pick(['#2e6a2a', '#346e2e', '#285e24', '#3a7a32', '#24561e']))),
    cloud: tex(canvasOf(16, 16, (x, y) => ((x * 5 + y * 7) % 13 < 2) ? '#c8dcf4' : pick(['#ffffff', '#f4f8ff', '#eef4ff', '#e4eefc']))),
    cloudDeck: tex(canvasOf(16, 16, (x, y) => (y % 8 === 0) ? '#a8c0dc' : pick(['#e8f0fa', '#dce8f6', '#f0f6ff']))),
    metal: tex(canvasOf(16, 16, (x, y) => (x % 8 === 0 || y % 8 === 0) ? '#2e2e34' : ((x + y) % 5 === 0 ? '#5e6068' : pick(['#4a4c54', '#46484f', '#4e5058'])))),
    metal2: tex(canvasOf(16, 16, (x, y) => (x + y) % 4 < 2 ? '#6a6c74' : '#5a5c64')),
    sandstone: tex(canvasOf(16, 16, (x, y) => (y % 4 === 0 || (x + (y >> 2) * 4) % 8 === 0) ? '#a07840' : pick(['#d8b878', '#d0b070', '#dcc084']))),
    stoneRoad: tex(canvasOf(44, 16, (x, y) => {
      if (x === 1 || x === 42) return '#f2e6c8';
      if (y % 8 === 0 || (x + (y >> 3) * 5) % 10 === 0) return '#8a7050';
      return pick(['#b89a6a', '#b0925f', '#c0a274']);
    })),
    oil: tex(canvasOf(16, 16, (x, y) => ((x * 3 + y * 5) % 11 === 0) ? '#5a4a7a' : pick(['#16161c', '#1c1a24', '#121218', '#201c2a']))),
    mud: tex(canvasOf(16, 16, () => pick(['#6a4a2a', '#5e4224', '#74522e', '#563c20']))),
    dirtRoad: tex(canvasOf(44, 16, (x, y) => {
      if ((x === 12 || x === 13 || x === 30 || x === 31) && y % 3 !== 0) return '#7a5a34';
      return pick(['#a07a4a', '#9a7444', '#a8824e', '#94703f']);
    })),
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
// 테마별 주변 언덕 높이 (0 = 평지)
const HILLS = { grass: 34, desert: 22, snow: 46, night: 0, beach: 16, canyon: 60, autumn: 52, volcano: 48, port: 0, rainbow: 0, jungle: 32, dusk: 30, sky: 0, factory: 0, tomb: 18 };
const AD_TEXT = ['PIXEL RACER', 'TURBO', 'NITRO+', 'KART CUP', 'SPEED', 'GO GO!', 'DRIFT', 'GRAND PRIX', 'BOOST', '레이서 컵', '픽셀 모터스', '부스터 콜라'];
const AD_COL = [['#d83a3a', '#fff'], ['#2a2a2e', '#f2c230'], ['#3a6fd8', '#fff'], ['#f2c230', '#2a2a2e'], ['#3aa64a', '#fff'], ['#9a4ad8', '#fff']];

function buildArena(a) {
  const th = THEMES[a.theme], T = X.T, g = new THREE.Group();
  g.visible = false;
  X.scene.add(g);
  const add = (geo, mat, shadow) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; if (shadow) m.castShadow = true; g.add(m); return m; };
  const b = a.bounds, M = 340, roads = [a, ...a.alts];
  const [ground, runoff, road] = GROUND[a.theme].slice(0, 3).map(texOf);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const R = W.rng(a.id.length * 97 + 13);

  // ---------- 주변 지형: 길 가까이는 평평, 멀어질수록 언덕/산 ----------
  const amp = HILLS[a.theme] || 0;
  const noise = (x, z) => 0.5 + 0.22 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 - 0.7) + 0.16 * Math.sin(x * 0.027 + z * 0.019) + 0.12 * Math.cos(x * 0.051 - z * 0.043 + 2);
  const seaCut = (x) => (a.theme === 'beach' && x > b.x2 + 50) || (a.theme === 'port' && x < b.x1 - 50);
  const terrainH = (x, z) => {
    if (!amp || seaCut(x)) return 0;
    const rd = W.roadDist(a, x, z, 3), d = rd.d;
    if (d < 7) return 0;
    const f = Math.min(1, (d - 7) / 90), s = f * f * (3 - 2 * f);
    const far = Math.min(1, Math.max(0, (d - 150) / 250));
    return amp * noise(x, z) * s * (1 + far * 1.2);
  };
  a.terrainH = terrainH;
  {
    const G = 16, x0 = Math.floor((b.x1 - M) / G) * G, z0 = Math.floor((b.z1 - M) / G) * G;
    const nx = Math.ceil((b.x2 + M - x0) / G), nz = Math.ceil((b.z2 + M - z0) / G);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2), idx = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i, x = x0 + i * G, z = z0 + j * G;
      pos[k * 3] = x; pos[k * 3 + 1] = terrainH(x, z) - 0.02; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 4; uv[k * 2 + 1] = z / 4;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * (nx + 1) + i; idx.push(k, k + nx + 1, k + 1, k + 1, k + nx + 1, k + nx + 2); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); tg.setIndex(idx);
    tg.computeVertexNormals();
    add(tg, lam({ map: ground }));
  }
  // 해변: 동쪽은 바다 / 항구: 서쪽은 바다 / 화산: 용암 호수
  if (a.theme === 'beach') add(flatQuad(b.x2 + 50, b.z1 - M, b.x2 + M + 400, b.z2 + M, 0.08, 4), lam({ map: T.water, emissive: 0x0a2a4a }));
  if (a.theme === 'port') add(flatQuad(b.x1 - M - 400, b.z1 - M, b.x1 - 50, b.z2 + M, 0.08, 4), lam({ map: T.water, emissive: 0x0a2a4a }));
  if (a.theme === 'volcano') for (let k = 0; k < 6; k++) {
    const r = 40 + R() * 50, cx = b.x1 - 100 + R() * (b.x2 - b.x1 + 200), cz = b.z1 - 100 + R() * (b.z2 - b.z1 + 200);
    if (W.roadDist(a, cx, cz, 4).d > r + 10) add(flatQuad(cx - r, cz - r, cx + r, cz + r, terrainH(cx, cz) + 0.3, 4), new THREE.MeshBasicMaterial({ map: TX.lava }));
  }

  // ---------- 길 (본 코스 + 지름길) ----------
  const roadMat = a.theme === 'rainbow' ? new THREE.MeshBasicMaterial({ map: road }) : lam({ map: road });
  const runMat = a.theme === 'volcano' ? new THREE.MeshBasicMaterial({ map: runoff }) : lam({ map: runoff });
  const curbMat = th.glow ? new THREE.MeshBasicMaterial({ map: T.curb, color: 0xff80d0 }) : lam({ map: T.curb });
  const off = m => { const c = m.clone(); c.polygonOffset = true; c.polygonOffsetFactor = -2; c.polygonOffsetUnits = -2; return c; };
  const deckMat = lam({ map: th.deck ? texOf(th.deck) : T.concrete, side: THREE.DoubleSide });
  const pillarsAt = [];
  for (const r of roads) {
    const n = r.path.length, alt = r !== a;
    const hw = i => r.hw[i], wbo = i => r.wbs[i] + 0.5;
    const skip = i => (r.open && i >= n - 1) || r.gap[i] || r.gap[(i + 1) % n];
    const rm = alt ? off(roadMat) : roadMat, um = alt ? off(runMat) : runMat, cm = alt ? off(curbMat) : curbMat;
    add(ribbon(r, i => -hw(i), hw, 0.06, 8, skip), rm);
    add(ribbon(r, i => hw(i) + 1.6, wbo, 0.04, 4, skip), um);
    add(ribbon(r, i => -wbo(i), i => -hw(i) - 1.6, 0.04, 4, skip), um);
    add(ribbon(r, hw, i => hw(i) + 1.6, 0.09, 4, skip), cm);
    add(ribbon(r, i => -hw(i) - 1.6, i => -hw(i), 0.09, 4, skip), cm);
    if (r.patch) {
      const pm = { oil: lam({ map: TX.oil, transparent: true, opacity: 0.9 }), mud: lam({ map: TX.mud }) };
      for (const kind of ['oil', 'mud']) if (r.patch.includes(kind)) add(ribbon(r, i => -hw(i) + 0.4, i => hw(i) - 0.4, 0.11, 6, i => r.patch[i] !== kind || skip(i)), pm[kind]);
    }
    // 높은 길: 아래판 + 옆면 + 기둥
    if (r.ey.some(e => e > 1.2)) {
      const high = i => r.ey[i] > 1.2 || r.ey[(i + 1) % n] > 1.2;
      add(ribbon(r, i => -wbo(i), wbo, -0.7, 6, i => !high(i) || skip(i)), deckMat);
      const pos = [], uv = [];
      let dist = 0;
      for (let i = 0; i < n; i++) {
        const i2 = (i + 1) % n, pa = r.path[i], pb = r.path[i2], ta = r.tan[i], tb = r.tan[i2];
        const seg = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        if (high(i) && !skip(i)) for (const sd of [1, -1]) {
          const ax = pa[0] + ta[1] * sd * wbo(i), az = pa[1] - ta[0] * sd * wbo(i), bx = pb[0] + tb[1] * sd * wbo(i2), bz = pb[1] - tb[0] * sd * wbo(i2);
          const ea = r.ey[i], eb = r.ey[i2], la = ea < 6 ? 0 : ea - 0.8, lb = eb < 6 ? 0 : eb - 0.8;
          pos.push(ax, ea + 0.05, az, bx, eb + 0.05, bz, bx, lb, bz, ax, ea + 0.05, az, bx, lb, bz, ax, la, az);
          const u0 = dist / 4, u1 = (dist + seg) / 4;
          uv.push(u0, ea / 4, u1, eb / 4, u1, lb / 4, u0, ea / 4, u1, lb / 4, u0, la / 4);
        }
        dist += seg;
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      sg.computeVertexNormals();
      add(sg, deckMat);
      for (let i = 0; i < n; i += 6) {
        if (r.ey[i] <= 6 || [-4, -2, 0, 2, 4].some(k => r.gap[(i + k + n) % n])) continue;
        // 아래에 다른 길이 지나가면 기둥 생략
        const below = W.trackAt(a, r.path[i][0], r.path[i][1], r.ey[i] - 4);
        if (below && Math.abs(below.e - r.ey[i]) > 4) continue;
        pillarsAt.push([r.path[i][0], r.path[i][1], r.ey[i] - 0.7]);
      }
    }
  }
  if (pillarsAt.length) {
    const pm = new THREE.InstancedMesh(boxUV(3, 1, 3, 4), lam({ map: T.concrete }), pillarsAt.length);
    pillarsAt.forEach(([x, z, e], k) => { m4.makeScale(1, e, 1); m4.setPosition(x, e / 2, z); pm.setMatrixAt(k, m4); });
    pm.castShadow = true; pm.receiveShadow = true;
    g.add(pm);
  }
  g.add(startLine(a, T), gantry(a, T));

  // ---------- 벽 (타이어 벽 / 네온 블록) ----------
  const allBars = [...a.barriers, ...a.alts.flatMap(r => r.barriers)];
  const barMat = th.glow ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : lam({ color: 0xffffff });
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.3, 1), barMat, allBars.length);
  allBars.forEach((s, i) => {
    const dx = s[2] - s[0], dz = s[3] - s[1], len = Math.hypot(dx, dz);
    q.setFromAxisAngle(up, Math.atan2(dx, dz));
    p.set((s[0] + s[2]) / 2 - s[4] * 0.5, 0.65 + (s[6] || 0), (s[1] + s[3]) / 2 - s[5] * 0.5);
    sc.set(1, 1, len + 0.25);
    m4.compose(p, q, sc);
    bars.setMatrixAt(i, m4);
    bars.setColorAt(i, col.setHex(th.bar[(i >> 2) % 2]));
  });
  bars.castShadow = !th.glow; bars.receiveShadow = true;
  g.add(bars);

  // ---------- 터널: 벽 + 천장 + 조명 + 위를 덮는 산 ----------
  const tunnelSegs = [];
  for (const [i0, i1] of a.tunnels) { const n = a.path.length; for (let i = i0; i !== i1; i = (i + 1) % n) tunnelSegs.push([a, i]); }
  for (const r of a.alts) if (r.tunnel) for (let i = 6; i < r.path.length - 7; i++) tunnelSegs.push([r, i]);
  if (tunnelSegs.length) {
    const H = 10, pos = [], uv = [], lamps = [], rocks = [];
    for (const [r, i] of tunnelSegs) {
      const n = r.path.length, i2 = (i + 1) % n, pa = r.path[i], pb = r.path[i2], ta = r.tan[i], tb = r.tan[i2];
      const wa = r.wbs[i] + 0.6, wb = r.wbs[i2] + 0.6, ea = r.ey[i], eb = r.ey[i2];
      const L = (s, w, e, pp, tt) => [pp[0] + tt[1] * s * w, e, pp[1] - tt[0] * s * w];
      for (const sd of [1, -1]) {
        const A = L(sd, wa, ea, pa, ta), B = L(sd, wb, eb, pb, tb);
        pos.push(...A, ...B, B[0], eb + H, B[2], ...A, B[0], eb + H, B[2], A[0], ea + H, A[2]);
        uv.push(0, 0, 1, 0, 1, H / 4, 0, 0, 1, H / 4, 0, H / 4);
      }
      const A1 = L(1, wa, ea + H, pa, ta), A2 = L(-1, wa, ea + H, pa, ta), B1 = L(1, wb, eb + H, pb, tb), B2 = L(-1, wb, eb + H, pb, tb);
      pos.push(...A1, ...B1, ...B2, ...A1, ...B2, ...A2); uv.push(0, 0, 1, 0, 1, 2, 0, 0, 1, 2, 0, 2);
      if (i % 3 === 0) lamps.push([pa[0], ea + H - 0.3, pa[1], Math.atan2(ta[0], ta[1])]);
      if (i % 4 === 0) rocks.push([pa[0], pa[1], ea, Math.atan2(ta[0], ta[1]), r.wbs[i]]);
    }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tgeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    tgeo.computeVertexNormals();
    add(tgeo, lam({ map: T.concrete, color: 0x9a9aa4, side: THREE.DoubleSide }));
    const lm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.3, 3), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }), lamps.length);
    lamps.forEach(([x, y, z, yaw], k) => { q.setFromAxisAngle(up, yaw); p.set(x, y, z); sc.set(1, 1, 1); m4.compose(p, q, sc); lm.setMatrixAt(k, m4); });
    g.add(lm);
    // 산: 길 양옆(벽 바깥)과 천장 위를 블록으로 덮음
    const rockCol = { snow: 0xe8eef6, desert: 0xc8a060, canyon: 0xa8583a, volcano: 0x3a2a28, tomb: 0xc8a060, night: 0x30344a, factory: 0x5a5c64 }[a.theme] || 0x6a7a4a;
    const parts = [];
    for (const [x, z, e, yaw, w] of rocks) {
      const h = H + 4 + R() * 6;
      parts.push([x, z, yaw, -(w + 13), 24, e + h, 0], [x, z, yaw, w + 13, 24, e + h, 0], [x, z, yaw, 0, w * 2 + 50, 5 + R() * 4, e + H + 0.5], [x, z, yaw, (R() - 0.5) * 10, w + 18, 4 + R() * 5, e + H + 5]);
    }
    const rm2 = new THREE.InstancedMesh(boxUV(1, 1, 1, 4), lam({ color: rockCol }), parts.length);
    parts.forEach(([x, z, yaw, side, wid, h, y0], k) => {
      q.setFromAxisAngle(up, yaw);
      p.set(x + Math.cos(yaw) * side, y0 + h / 2, z - Math.sin(yaw) * side); sc.set(wid, h, 22);
      m4.compose(p, q, sc); rm2.setMatrixAt(k, m4);
    });
    rm2.castShadow = true; rm2.receiveShadow = true;
    g.add(rm2);
  }

  // ---------- 로타리 가운데 섬 ----------
  for (const isl of a.islands) {
    const e = (W.trackAt(a, isl.x + isl.r + 4, isl.z) || { e: 0 }).e;
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(isl.r, isl.r + 0.6, 0.6, 24), lam({ map: T.grass }));
    grass.position.set(isl.x, e + 0.3, isl.z); grass.receiveShadow = true; g.add(grass);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(isl.r + 0.7, isl.r + 0.9, 0.5, 24, 1, true), lam({ map: T.curb, side: THREE.DoubleSide }));
    rim.position.set(isl.x, e + 0.25, isl.z); g.add(rim);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 1.2, 12), lam({ color: 0xc8c0b0 })); base.position.set(isl.x, e + 0.9, isl.z); g.add(base);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.3, 12), lam({ map: T.water, emissive: 0x0a2a4a })); water.position.set(isl.x, e + 1.55, isl.z); g.add(water);
    const col2 = new THREE.Mesh(boxUV(1.6, 7, 1.6, 2), lam({ color: 0xd8d0c0 })); col2.position.set(isl.x, e + 4.5, isl.z); col2.castShadow = true; g.add(col2);
    const top = new THREE.Mesh(boxUV(3, 2.4, 3, 2), lam({ color: 0xf2c230 })); top.position.set(isl.x, e + 9, isl.z); top.castShadow = true; g.add(top);
    const fl = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), lam({ color: 0xffffff }), 24);
    for (let k = 0; k < 24; k++) { const an = k / 24 * Math.PI * 2, rr = isl.r * 0.72; m4.makeTranslation(isl.x + Math.cos(an) * rr, e + 1.1, isl.z + Math.sin(an) * rr); fl.setMatrixAt(k, m4); fl.setColorAt(k, col.setHex([0xff5a8a, 0xf2e040, 0xffffff, 0xff8a3a][k % 4])); }
    g.add(fl);
  }

  // ---------- 점프대 / 부스터 / 기둥 ----------
  const rampMats = [lam({ map: T.plank, side: THREE.DoubleSide }), lam({ map: T.hazard, side: THREE.DoubleSide })];
  for (const r of W.ramps) if (W.arenaAt(r.cx) === a) { const m = add(wedgeGeo(r), rampMats, true); m.position.set(r.cx, r.y0 || 0, r.cz); m.rotation.y = r.rot; }
  const bMat = lam({ map: T.boost, emissive: 0x552200 });
  for (const bs of a.boostSpecs) {
    const geo = new THREE.PlaneGeometry(bs.w, bs.len); geo.rotateX(-Math.PI / 2);
    const m = add(geo, bMat); m.position.set(bs.cx, 0.12 + (bs.y || 0), bs.cz); m.rotation.y = bs.rot;
  }
  if (a.posts.length) {
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 8), lam({ map: T.hazard }), a.posts.length);
    a.posts.forEach((o, k) => { m4.makeTranslation(o.x, o.e + 1.5, o.z); pm.setMatrixAt(k, m4); });
    pm.castShadow = true;
    g.add(pm);
  }
  // 움직이는 장애물
  a.moverMeshes = a.movers.map(m => {
    const mat = lam({ map: T.hazard }), dark = lam({ color: 0x3a3a44 });
    const grp = new THREE.Group(), parts = [];
    if (m.k === 'slide') { const box = new THREE.Mesh(boxUV(4.5, 2.6, 3, 2), mat); box.castShadow = true; grp.add(box); parts.push(box); }
    else if (m.k === 'spin') {
      const bar = new THREE.Mesh(boxUV(1.2, 1.4, (m.hw - 1.5) * 2, 2), mat); bar.castShadow = true; grp.add(bar); parts.push(bar);
      const post = new THREE.Mesh(boxUV(1.6, 3.4, 1.6, 2), dark); post.position.set(m.x, m.e + 1.7, m.z); grp.add(post);
    } else {
      for (let k = 0; k < 2; k++) { const box = new THREE.Mesh(boxUV(m.hw - 0.6, 3, 6, 2), mat); box.castShadow = true; grp.add(box); parts.push(box); }
      for (const sd of [1, -1]) { const post = new THREE.Mesh(boxUV(1, 12, 1, 2), dark); post.position.set(m.x + m.tz * sd * (m.hw + 2), m.e + 6, m.z - m.tx * sd * (m.hw + 2)); g.add(post); }
      const beam = new THREE.Mesh(boxUV(1, 1, m.hw * 2 + 5, 2), dark); beam.position.set(m.x, m.e + 12, m.z); beam.rotation.y = Math.atan2(m.tx, m.tz) + Math.PI / 2; g.add(beam);
    }
    g.add(grp);
    return { grp, parts };
  });

  // ---------- 길가 장식: 아치, 광고판, 타이어 더미, 커브 화살표, 깃발, 관중석 ----------
  buildTrackside(a, g, th, T, R);

  // ---------- 장식 (길에서 떨어진 곳, 지형 높이에 맞춤) ----------
  const spots = [];
  const span = Math.max(b.x2 - b.x1, b.z2 - b.z1), want = Math.min(620, Math.round(280 * Math.max(1, span / 700)));
  for (let k = 0; k < want * 5 && spots.length < want; k++) {
    const x = b.x1 - 280 + R() * (b.x2 - b.x1 + 560), z = b.z1 - 280 + R() * (b.z2 - b.z1 + 560);
    if (seaCut(x)) continue;
    if (W.roadDist(a, x, z, 2).d > 9) spots.push([x, z, 0.8 + R() * 0.7, Math.floor(R() * 4), terrainH(x, z) - 0.3]);
  }
  buildDeco(g, th.deco, spots, T);

  // 밤: 트랙 가로등
  if (th.glow) {
    const pts = [];
    for (const r of roads) for (let i = 0; i < r.path.length; i += 10) if (!r.gap[i]) for (const s of [1, -1]) { const pp = r.path[i], tg = r.tan[i], o = r.wbs[i] + 1.5; pts.push([pp[0] + tg[1] * s * o, pp[1] - tg[0] * s * o, r.ey[i]]); }
    const pole = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 7, 0.3), lam({ color: 0x30344a }), pts.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }), pts.length);
    pts.forEach(([x, z, e], i) => { m4.makeTranslation(x, e + 3.5, z); pole.setMatrixAt(i, m4); m4.makeTranslation(x, e + 7.1, z); head.setMatrixAt(i, m4); });
    g.add(pole, head);
  }
  return g;
}

// 길가 장식 (본 코스 기준). 다른 길과 겹치는 자리는 건너뜀
function buildTrackside(a, g, th, T, R) {
  const n = a.path.length, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const lam2 = o => new THREE.MeshLambertMaterial(o);
  const curv = i => { const t0 = a.tan[(i - 3 + n) % n], t1 = a.tan[(i + 3) % n]; return t0[0] * t1[1] - t0[1] * t1[0]; }; // + 왼쪽, - 오른쪽
  const free = (x, z, e) => { const s = W.trackAt(a, x, z, e + 3); return !s || Math.abs(s.e - e) > 6; };
  const side = (i, sd, o) => { const pp = a.path[i], tg = a.tan[i]; return [pp[0] + tg[1] * sd * o, pp[1] - tg[0] * sd * o]; };
  const okHere = i => !a.gap[i] && !a.cross[i] && !(a.inTunnel && a.inTunnel(i));
  // 아치: 체크포인트 몇 군데 위
  const archBox = [];
  a.cps.forEach((ci, k) => {
    if (k === 0 || k % 3 !== 1 || !okHere(ci)) return;
    const pp = a.path[ci], tg = a.tan[ci], w = a.wbs[ci] + 1.2, e = a.ey[ci], yaw = Math.atan2(tg[0], tg[1]);
    archBox.push([pp[0] + tg[1] * w, pp[1] - tg[0] * w, e + 5, 1.6, 10, 1.6, yaw], [pp[0] - tg[1] * w, pp[1] + tg[0] * w, e + 5, 1.6, 10, 1.6, yaw], [pp[0], pp[1], e + 10.5, w * 2 + 1.6, 2, 1.2, yaw]);
  });
  if (archBox.length) {
    const am = new THREE.InstancedMesh(boxUV(1, 1, 1, 2), lam2({ map: T.checker }), archBox.length);
    archBox.forEach(([x, z, y, sx, sy, sz, yaw], k) => { q.setFromAxisAngle(up, yaw); p.set(x, y, z); sc.set(sx, sy, sz); m4.compose(p, q, sc); am.setMatrixAt(k, m4); });
    am.castShadow = true; g.add(am);
  }
  // 커브 화살표 + 타이어 더미 (급커브 바깥쪽)
  const chev = [], tires = [];
  for (let i = 0; i < n; i += 4) {
    const c = curv(i);
    if (Math.abs(c) < 0.16 || !okHere(i)) continue;
    const sd = c > 0 ? -1 : 1, e = a.ey[i];
    const [x, z] = side(i, sd, a.wbs[i] + 1.4);
    if (!free(x, z, e)) continue;
    const tg = a.tan[i];
    chev.push([x, z, e, Math.atan2(tg[0], tg[1]) + (sd > 0 ? -Math.PI / 2 : Math.PI / 2), c > 0]);
    if (e < 1.5 && i % 8 === 0) { const [tx, tz] = side(i, sd, a.wbs[i] + 4); if (free(tx, tz, e)) tires.push([tx, tz, e]); }
  }
  if (chev.length) {
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 16;
    const cg = cv.getContext('2d'); cg.fillStyle = '#d83a3a'; cg.fillRect(0, 0, 32, 16); cg.fillStyle = '#fff';
    for (let k = 0; k < 3; k++) { const x0 = 3 + k * 10; for (let y = 0; y < 12; y++) { const dx = Math.abs(y - 6); cg.fillRect(x0 + dx, 2 + y, 3, 1); } }
    const ct = tex(cv), ctFlip = tex(cv); ctFlip.repeat.x = -1; ctFlip.offset.x = 1;
    for (const left of [false, true]) {
      const list = chev.filter(c => c[4] === left);
      if (!list.length) continue;
      const mats = [lam2({ color: 0x3a3a44 }), lam2({ color: 0x3a3a44 }), lam2({ color: 0x3a3a44 }), lam2({ color: 0x3a3a44 }), lam2({ map: left ? ctFlip : ct }), lam2({ map: left ? ct : ctFlip })];
      const im = new THREE.InstancedMesh(boxUV(4, 2, 0.3, 2), mats, list.length);
      list.forEach(([x, z, e, yaw], k) => { q.setFromAxisAngle(up, yaw); p.set(x, e + 2.4, z); sc.set(1, 1, 1); m4.compose(p, q, sc); im.setMatrixAt(k, m4); });
      g.add(im);
    }
  }
  if (tires.length) {
    const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 0.9, 0.6, 8), lam2({ color: 0x1e1e22 }), tires.length * 3);
    tires.forEach(([x, z, e], k) => { for (let s = 0; s < 3; s++) { m4.makeTranslation(x + (s === 2 ? 0.9 : 0), e + 0.3 + (s === 1 ? 0.6 : 0), z + (s === 2 ? 0.9 : 0)); tm.setMatrixAt(k * 3 + s, m4); } });
    tm.castShadow = true; g.add(tm);
  }
  // 광고판 + 깃발 (직선 구간, 땅 높이 길만)
  const ads = [], flags = [];
  for (let i = 20; i < n; i += 36) {
    if (Math.abs(curv(i)) > 0.06 || !okHere(i) || a.ey[i] > 1.5) continue;
    const sd = (i / 36) % 2 ? 1 : -1, [x, z] = side(i, sd, a.wbs[i] + 7);
    if (!free(x, z, 0) || W.roadDist(a, x, z, 1).d < 3) continue;
    const tg = a.tan[i];
    ads.push([x, z, Math.atan2(tg[0], tg[1]) + (sd > 0 ? Math.PI / 2 : -Math.PI / 2), Math.floor(R() * AD_TEXT.length)]);
  }
  for (let i = 10; i < n; i += 12) {
    if (Math.abs(curv(i)) > 0.06 || !okHere(i) || a.ey[i] > 1.5 || R() < 0.4) continue;
    for (const sd of [1, -1]) { const [x, z] = side(i, sd, a.wbs[i] + 2.5); if (free(x, z, 0)) flags.push([x, z, (i + (sd > 0 ? 1 : 0)) % 4]); }
  }
  const byTex = {};
  ads.forEach(ad => { (byTex[ad[3]] = byTex[ad[3]] || []).push(ad); });
  for (const k in byTex) {
    const [bg, fg] = AD_COL[k % AD_COL.length], t = signTexture(AD_TEXT[k], bg, fg);
    const board = new THREE.InstancedMesh(boxUV(12, 4, 0.4, 2), [lam2({ color: 0x3a3a44 }), lam2({ color: 0x3a3a44 }), lam2({ color: 0x3a3a44 }), lam2({ color: 0x3a3a44 }), lam2({ map: t }), lam2({ map: t })], byTex[k].length);
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 5, 0.4), lam2({ color: 0x5a5a64 }), byTex[k].length * 2);
    byTex[k].forEach(([x, z, yaw], j) => {
      q.setFromAxisAngle(up, yaw); p.set(x, 6, z); sc.set(1, 1, 1); m4.compose(p, q, sc); board.setMatrixAt(j, m4);
      for (const s of [-1, 1]) { m4.makeTranslation(x + Math.cos(yaw) * s * 4.5, 2.5, z - Math.sin(yaw) * s * 4.5); legs.setMatrixAt(j * 2 + (s > 0 ? 1 : 0), m4); }
    });
    board.castShadow = true; g.add(board, legs);
  }
  if (flags.length) {
    const pole = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 6, 0.2), lam2({ color: 0xdddddd }), flags.length);
    const fl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 1.4, 2.2), lam2({ color: 0xffffff }), flags.length);
    const fc = [th.bar[0], th.bar[1], 0xf2c230, 0x3a6fd8];
    flags.forEach(([x, z, c], k) => { m4.makeTranslation(x, 3, z); pole.setMatrixAt(k, m4); m4.makeTranslation(x, 5.2, z + 1.1); fl.setMatrixAt(k, m4); fl.setColorAt(k, new THREE.Color(fc[c])); });
    g.add(pole, fl);
  }
  // 관중석: 출발선 옆 + 긴 직선 두 군데
  const crowd = lam2({ map: TX.crowd }), conc = lam2({ map: T.concrete });
  const stand = (i, sd) => {
    const p0 = a.path[i], tg = a.tan[i], nx = -tg[1] * sd, nz = tg[0] * sd, e0 = a.ey[i];
    const st = new THREE.Group();
    st.position.set(p0[0] + nx * (a.wbs[i] + 9), e0, p0[1] + nz * (a.wbs[i] + 9));
    st.rotation.y = Math.atan2(tg[0], tg[1]) + (sd < 0 ? Math.PI : 0);
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Mesh(boxUV(6, 1.2 + k * 1.2, 70, 4), [crowd, crowd, conc, conc, conc, conc]);
      m.position.set(k * 3, (1.2 + k * 1.2) / 2, 0); m.castShadow = true; m.receiveShadow = true; st.add(m);
    }
    const roof = new THREE.Mesh(boxUV(18, 0.6, 72, 4), conc); roof.position.set(6, 9, 0); roof.castShadow = true; st.add(roof);
    g.add(st);
  };
  stand(6, 1);
  let made = 0;
  for (let i = Math.floor(n * 0.3); i < n - 20 && made < 2; i += 7) {
    if (Math.abs(curv(i)) > 0.03 || !okHere(i) || a.ey[i] > 1.5) continue;
    const sd = made ? 1 : -1, [x, z] = side(i, sd, a.wbs[i] + 18);
    if (!free(x, z, 0) || W.roadDist(a, x, z, 2).d < 12) continue;
    stand(i, sd); made++; i += Math.floor(n * 0.25);
  }
}

// 움직이는 장애물의 지금 모양 (모든 사람이 같은 시계(Date.now)로 계산해서 대충 맞음)
// 반환: 상자 목록 {x,z,y,ux,uz,hu,hv,h,vx,vz} (u = 상자의 긴 축 방향 단위벡터, hu/hv = 반 길이, y = 바닥 높이, h = 높이)
function moverBoxes(m, t) {
  const nx = m.tz, nz = -m.tx, ph = t / m.period + m.phase, out = [];
  if (m.k === 'slide') {
    const amp = Math.max(0, m.hw - 2.6), s = Math.sin(ph * Math.PI * 2), v = Math.cos(ph * Math.PI * 2) * amp * Math.PI * 2 / m.period;
    out.push({ x: m.x + nx * amp * s, z: m.z + nz * amp * s, y: m.e, ux: m.tx, uz: m.tz, hu: 1.5, hv: 2.25, h: 2.6, vx: nx * v, vz: nz * v });
  } else if (m.k === 'spin') {
    const th = ph * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    out.push({ x: m.x, z: m.z, y: m.e + 0.2, ux: nx * c + m.tx * s, uz: nz * c + m.tz * s, hu: m.hw - 1.5, hv: 0.6, h: 1.4, spin: Math.PI * 2 / m.period });
  } else {
    for (let k = 0; k < 2; k++) {
      const u = ((ph + k * 0.5) % 1 + 1) % 1, sd = k ? 1 : -1;
      const lift = u < 0.35 ? 7 : (u < 0.42 ? 7 * (1 - (u - 0.35) / 0.07) : (u < 0.75 ? 0 : 7 * (u - 0.75) / 0.25));
      const off = sd * m.hw / 2;
      out.push({ x: m.x + nx * off, z: m.z + nz * off, y: m.e + lift, ux: m.tx, uz: m.tz, hu: 3, hv: m.hw / 2 - 0.3, h: 3, vx: 0, vz: 0 });
    }
  }
  return out;
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
    maple: [[1, 4, 1, 0, 2, T.bark, 0xffffff], [5, 4, 5, 0, 5.5, null, 0xd8602a], [3, 2, 3, 0, 8.5, null, 0xe8a030]],
    lava: [[6, 5, 6, 0, 2.5, null, 0x3a2a28], [4.5, 3, 4.5, 0.6, 6.5, null, 0x2a2020], [2, 0.6, 2, 0.6, 8.3, 'glow', 0xff6a20]],
    container: [[12, 2.6, 2.6, 0, 1.3, null, 0xc83a32], [12, 2.6, 2.6, 0, 3.9, null, 0x3a6fd8], [12, 2.6, 2.6, 0.3, 6.5, null, 0xe0b030]],
    star: [[2, 2, 2, 0, 12, 'glow', 0xfff07a], [1.2, 1.2, 1.2, 1.5, 17, 'glow', 0x7ae8ff], [0.8, 0.8, 0.8, -1.5, 8, 'glow', 0xff8ad8]],
    jungle: [[0.8, 9, 0.8, 0, 4.5, T.bark, 0xffffff], [7, 0.5, 1.6, 0, 9.2, null, 0x2e8a2e], [1.6, 0.5, 7, 0, 9.2, null, 0x2e8a2e], [4, 2.4, 4, 1.8, 1.2, null, 0x2a6a2a]],
    cloud: [[12, 3, 8, 0, 2, null, 0xffffff], [7, 3, 6, 4, 4, null, 0xf4f8ff], [8, 2.4, 6, -4, 3, null, 0xeaf2ff]],
    chimney: [[5, 24, 5, 0, 12, null, 0x6a5a52], [5.6, 1.2, 5.6, 0, 23.4, null, 0xd83a3a], [12, 7, 9, 5, 3.5, null, 0x5a6070]],
    pyramid: [[16, 4, 16, 0, 2, TX.sandstone, 0xffffff], [11, 4, 11, 0, 6, TX.sandstone, 0xffffff], [6, 4, 6, 0, 10, TX.sandstone, 0xffffff], [2.4, 2.4, 2.4, 0, 13.2, null, 0xf2c230]],
  }[kind];
  const glowKind = kind === 'neon' || kind === 'star';
  for (const [sx, sy, sz, ox, oy, map, color] of parts) {
    const mat = map === 'win' ? new THREE.MeshBasicMaterial({ map: TX.win }) : ((kind === 'neon' && !map) || map === 'glow' ? new THREE.MeshBasicMaterial({ color }) : lam({ map: map || null, color }));
    const inst = new THREE.InstancedMesh(boxUV(sx, sy, sz, 4), mat, spots.length);
    spots.forEach(([x, z, k, r, y0], i) => {
      const hk = kind === 'neon' ? k * 1.6 : (kind === 'rock' || kind === 'lava' ? k * 1.8 : k);
      q.setFromAxisAngle(up, r * Math.PI / 2);
      const c = Math.cos(r * Math.PI / 2), sn = Math.sin(r * Math.PI / 2);
      p.set(x + ox * c * k, (y0 || 0) + oy * hk, z - ox * sn * k); s.set(k, hk, k);
      m4.compose(p, q, s); inst.setMatrixAt(i, m4);
    });
    inst.castShadow = !glowKind && map !== 'glow';
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
  g.fillStyle = GROUND[a.theme][3]; g.fillRect(0, 0, size, size);
  g.lineJoin = 'round';
  // 낮은 길부터 그려서 다리가 위로 보이게. 지름길은 노란 점선 테두리
  const segs = [];
  for (const r of [a, ...a.alts]) { const m = r.path.length; for (let i = 0; i < (r.open ? m - 1 : m); i++) segs.push([r, i]); }
  segs.sort((u, v) => u[0].ey[u[1]] - v[0].ey[v[1]]);
  const barCol = '#' + th.bar[0].toString(16).padStart(6, '0'), roadCol = a.theme === 'snow' ? '#8ab8e0' : '#3e3e44';
  g.lineCap = 'round';
  for (const [r, i] of segs) {
    const m = r.path.length, p1 = r.path[i], p2 = r.path[(i + 1) % m], [x1, y1] = to(p1[0], p1[1]), [x2, y2] = to(p2[0], p2[1]);
    const lift = Math.min(1, r.ey[i] / 30), alt = r !== a;
    g.strokeStyle = alt ? '#f2c230' : (r.ey[i] > 4 ? '#000' : barCol); g.lineWidth = (r.wbs[i] * 2 + 4) * s + (r.ey[i] > 4 ? 3 : 0);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    const tun = !alt ? a.inTunnel(i) : r.tunnel;
    g.strokeStyle = r.gap[i] ? '#111' : (tun ? '#22222a' : (lift > 0.1 ? `rgb(${62 + lift * 90},${62 + lift * 90},${68 + lift * 90})` : roadCol));
    g.lineWidth = r.hw[i] * 2 * s * 1.4;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  for (const isl of a.islands) { const [ix, iy] = to(isl.x, isl.z); g.fillStyle = '#4f9530'; g.beginPath(); g.arc(ix, iy, isl.r * s, 0, Math.PI * 2); g.fill(); }
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
    m.position.set(b.x, (b.y || 0) + 1.6, b.z);
    X.scene.add(m);
    boxMeshes.push({ m, x: b.x, z: b.z, y: b.y || 0, back: 0 });
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
  o.y = Number.isFinite(m.y) ? m.y : W.groundHeight(m.x, m.z);
  o.y2 = Number.isFinite(m.y2) ? m.y2 : W.groundHeight(m.x2, m.z2);
  if (m.kind === 'banana') {
    o.mesh = new THREE.Group();
    const b1 = new THREE.Mesh(G.banana, G.bananaMat); b1.rotation.y = 0.5; b1.position.x = -0.3;
    const b2 = new THREE.Mesh(G.banana, G.bananaMat); b2.rotation.y = -0.5; b2.position.x = 0.3;
    o.mesh.add(b1, b2);
    o.mesh.position.set(m.x, o.y + 0.4, m.z);
  } else {
    o.mesh = new THREE.Mesh(G.ball, G.ballMat);
    o.splash = new THREE.Mesh(G.splash, G.splashMat); o.splash.visible = false;
    o.splash.position.set(m.x2, o.y2 + 0.2, m.z2);
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
  X.spawnCar(s.x, s.z, s.yaw, s.y);
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
const DIFF_NAME = { 1: '입문', 2: '쉬움', 3: '보통', 4: '어려움', 5: '지옥' };
function trackTags(a) {
  const t = [];
  if (a.alts.length) t.push('지름길 ' + a.alts.length + '개');
  if (a.tunnels.length || a.alts.some(r => r.tunnel)) t.push('터널');
  if (a.islands.length) t.push('로타리');
  if (Math.max(...a.ey) - Math.min(...a.ey) > 15) t.push('높이차 ' + Math.round(Math.max(...a.ey) - Math.min(...a.ey)) + 'm');
  if (a.elev) t.push('고가도로');
  if (a.cross.some(Boolean) && a.elev) t.push('입체 교차');
  if (a.gap.some(Boolean)) t.push('낭떠러지 점프');
  if (W.ramps.some(r => W.arenaAt(r.cx) === a)) t.push('점프대');
  if (a.movers.length) t.push('움직이는 장애물');
  if (a.posts.length) t.push('기둥 슬라럼');
  if (a.patch && a.patch.includes('oil')) t.push('기름');
  if (a.patch && a.patch.includes('mud')) t.push('진흙');
  if (a.theme === 'snow') t.push('빙판');
  if (Math.min(...a.hw) * 2 < 15) t.push('좁은 길');
  return t.length ? `<br><span class="muted">${t.join(' · ')}</span>` : '';
}
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
  $('glTrack').innerHTML = [1, 2, 3, 4, 5].map(d => `<optgroup label="난이도 ${d} · ${DIFF_NAME[d]}">` + W.arenas.filter(t => t.diff === d).map(t => `<option value="${t.id}" ${t.id === set.track ? 'selected' : ''}>${t.name} (${(t.length / 1000).toFixed(1)}km)</option>`).join('') + '</optgroup>').join('');
  $('glTrackDesc').innerHTML = `<span class="diff d${a.diff}">${'■'.repeat(a.diff)}${'□'.repeat(5 - a.diff)} ${DIFF_NAME[a.diff]}</span> ${(a.length / 1000).toFixed(1)}km · ${X.esc(a.desc)}${trackTags(a)}`;
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
    case 'banana': { const back = car.shape.len / 2 + 2; X.send({ t: 'gi', k: 'obj', kind: 'banana', x: car.x - fx * back, z: car.z - fz * back, y: car.y }); break; }
    case 'water': { const d = 30 + sp * 0.4; const x2 = car.x + fx * d, z2 = car.z + fz * d; X.send({ t: 'gi', k: 'obj', kind: 'water', x: car.x, z: car.z, y: car.y, x2, z2, y2: W.groundHeight(x2, z2, car.y + 3) }); X.sfx.item(); break; }
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

// 차(원 여러 개) ↔ 회전된 상자 충돌. 밀어내고 튕기고 살짝 돌게
function hitMover(car, bx) {
  const sh = car.shape, vx0 = bx.ux, vz0 = bx.uz, wx = vz0, wz = -vx0;
  let hit = false;
  for (const oz of sh.offs) {
    const cx = car.x + Math.sin(car.yaw) * oz, cz = car.z + Math.cos(car.yaw) * oz;
    const dx = cx - bx.x, dz = cz - bx.z, lu = dx * vx0 + dz * vz0, lv = dx * wx + dz * wz;
    const qu = clamp(lu, -bx.hu, bx.hu), qv = clamp(lv, -bx.hv, bx.hv);
    let nu = lu - qu, nv = lv - qv, d = Math.hypot(nu, nv), pen;
    if (d >= sh.r) continue;
    if (d < 1e-4) { // 안에 들어감 → 가까운 면으로
      const ou = bx.hu - Math.abs(lu), ov = bx.hv - Math.abs(lv);
      if (ou < ov) { nu = Math.sign(lu) || 1; nv = 0; pen = ou + sh.r; } else { nu = 0; nv = Math.sign(lv) || 1; pen = ov + sh.r; }
    } else { nu /= d; nv /= d; pen = sh.r - d; }
    const nx = nu * vx0 + nv * wx, nz = nu * vz0 + nv * wz;
    car.x += nx * pen; car.z += nz * pen;
    let ovx = bx.vx || 0, ovz = bx.vz || 0;
    if (bx.spin) { const rx = cx - bx.x, rz = cz - bx.z; ovx = -rz * bx.spin; ovz = rx * bx.spin; }
    const rv = (car.vx - ovx) * nx + (car.vz - ovz) * nz;
    if (rv < 0) { car.vx -= rv * nx * 1.6; car.vz -= rv * nz * 1.6; }
    const push = ovx * nx + ovz * nz;
    if (push > 0) { car.vx += nx * push * 0.6; car.vz += nz * push * 0.6; }
    if (rv < -4 || push > 4) hit = true;
  }
  if (hit && car.hitCd <= 0) {
    car.hitCd = 0.4; car.bumpT = 0.4; car.yawRate += (Math.random() < 0.5 ? -1 : 1) * 3;
    X.sfx.crash(12); X.camState.shake = 0.35;
    for (let i = 0; i < 8; i++) X.spawnPart(car.x, car.y + 1, car.z, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 0xffd040, 0.5, 0.7);
  }
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
    X.spawnCar(p[0], p[1], Math.atan2(tg[0], tg[1]), a.ey[idx]);
  } else {
    const p = W.respawnPoint(car.x, car.z, car.y + 2);
    X.spawnCar(p.x, p.z, p.yaw, p.y);
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
      b.m.position.y = b.y + 1.6 + Math.sin(t * 3 + b.x) * 0.2;
      if (!GP.spectating() && Math.hypot(car.x - b.x, car.z - b.z) < 2.6 && Math.abs(car.y - b.y) < 4) {
        b.back = now + 2500; b.m.visible = false;
        if (S.items.length < 2) { S.items.push(rollItem()); X.sfx.item(); renderHud(); }
        for (let k = 0; k < 8; k++) X.spawnPart(b.x, b.y + 1.6, b.z, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0x9a80ff, 0.5, 0.7);
      }
    }
  }

  // 바나나 / 물폭탄
  for (const o of objs.values()) {
    const age = (now - o.t0) / 1000;
    if (o.kind === 'banana') {
      o.mesh.rotation.y = t * 2;
      if (age > 0.4 && !GP.spectating() && Math.hypot(car.x - o.x, car.z - o.z) < 2.2 && Math.abs(car.y - o.y) < 2.5) { hitMe('banana'); X.send({ t: 'gi', k: 'rm', id: o.id }); removeObj(o.id); }
      if (age > 60) removeObj(o.id);
    } else {
      const fly = 0.7;
      if (age < fly) {
        const k = age / fly;
        o.mesh.position.set(o.x + (o.x2 - o.x) * k, o.y + (o.y2 - o.y) * k + 1.5 + Math.sin(k * Math.PI) * 8, o.z + (o.z2 - o.z) * k);
      } else {
        if (!o.splash.visible) { o.splash.visible = true; o.mesh.visible = false; X.sfx.splash(); }
        const s = 1 + Math.sin(t * 6) * 0.05;
        o.splash.scale.set(s, 1, s);
        if (Math.random() < 0.3) X.spawnPart(o.x2 + (Math.random() - 0.5) * 8, o.y2 + 0.5, o.z2 + (Math.random() - 0.5) * 8, 0, 2 + Math.random() * 2, 0, 0x8ac8ff, 0.5, 0.6);
        if (!GP.spectating() && !o.hitBy.has(me) && Math.hypot(car.x - o.x2, car.z - o.z2) < 5.2 && Math.abs(car.y - o.y2) < 4) { o.hitBy.add(me); hitMe('water'); }
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

  // 움직이는 장애물: 모양 갱신 + 내 차와 충돌
  const wt = (Date.now() % 1e8) / 1000;
  a.movers.forEach((m, k) => {
    const boxes = moverBoxes(m, wt), mm = a.moverMeshes && a.moverMeshes[k];
    if (mm) boxes.forEach((bx, j) => { const part = mm.parts[j]; if (part) { part.position.set(bx.x, bx.y + bx.h / 2, bx.z); part.rotation.y = Math.atan2(bx.ux, bx.uz); } });
    if (GP.spectating() || Math.hypot(car.x - m.x, car.z - m.z) > 40 || Math.abs(car.y - m.e) > 5) return;
    for (const bx of boxes) if (bx.y < car.y + 1.6) hitMover(car, bx);
  });
  // 낭떠러지로 떨어지면 마지막 체크포인트로
  if (a.elev && !GP.spectating() && car.respawnCd <= 0) {
    const on = W.trackAt(a, car.x, car.z, car.y + 2.5);
    if (!on || on.gap) {
      const below = W.trackAt(a, car.x, car.z);
      if ((below ? below.e : 0) - car.y > 5 || (car.grounded && !on)) { car.respawnCd = 1; X.toast('추락! 마지막 체크포인트로 돌아가요'); respawnGP(); }
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
      const i = S.c % n, ci = a.cps[i], cp = a.path[ci], ce = a.ey[ci];
      if (Math.hypot(car.x - cp[0], car.z - cp[1]) < Math.max(a.w * 0.9, a.hw[ci] * 1.8) && car.y > ce - 5 && car.y < ce + 14) {
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
      const near = W.trackAt(a, car.x, car.z, car.y + 2.5) || W.nearestOnTrack(a, car.x, car.z, 1), tt = (near.tr || a).tan[near.i];
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
    const left = Math.max(0, ((S.endAt || S.startAt + 75000) - now) / 1000);
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
